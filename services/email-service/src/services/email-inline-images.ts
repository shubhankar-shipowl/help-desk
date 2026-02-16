import { uploadEmailAttachmentToMega } from './mega-storage';

export interface InlineImage {
  src: string;
  cid?: string;
  mimeType: string;
  data: Buffer;
  filename: string;
}

/**
 * Extract inline images from HTML content
 * Handles both data URIs (base64) and CID references
 */
export function extractInlineImagesFromHtml(
  htmlContent: string | null,
  parsedAttachments?: Array<{
    cid?: string;
    contentType?: string;
    content?: Buffer;
    filename?: string;
  }>,
): InlineImage[] {
  if (!htmlContent) return [];

  const MAX_HTML_SIZE = 5 * 1024 * 1024;
  if (htmlContent.length > MAX_HTML_SIZE) {
    console.warn(`[Extract Images] HTML too large (${(htmlContent.length / 1024 / 1024).toFixed(2)} MB), skipping`);
    return [];
  }

  const inlineImages: InlineImage[] = [];

  try {
    const tagPattern = /<(img|video)/gi;
    const tagPositions: Array<{ index: number; tagType: string }> = [];
    let tagMatch: RegExpExecArray | null;

    while ((tagMatch = tagPattern.exec(htmlContent)) !== null) {
      tagPositions.push({ index: tagMatch.index, tagType: tagMatch[1].toLowerCase() });
      if (tagMatch.index === tagPattern.lastIndex) tagPattern.lastIndex++;
    }

    for (let i = 0; i < tagPositions.length; i++) {
      const { index, tagType } = tagPositions[i];
      const chunkStart = Math.max(0, index);
      const initialChunkEnd = Math.min(htmlContent.length, index + 500);
      const initialChunk = htmlContent.substring(chunkStart, initialChunkEnd);

      const srcStartMatch = initialChunk.match(/src=[\"']/i);
      if (!srcStartMatch) continue;

      const srcAttrStart = chunkStart + srcStartMatch.index! + srcStartMatch[0].length;
      const quoteChar = srcStartMatch[0].slice(-1);
      const maxSrcLength = 2 * 1024 * 1024;
      const searchEnd = Math.min(htmlContent.length, srcAttrStart + maxSrcLength);

      let closingQuoteIndex = -1;
      for (let j = srcAttrStart; j < searchEnd; j++) {
        if (htmlContent[j] === quoteChar) { closingQuoteIndex = j; break; }
      }

      if (closingQuoteIndex === -1) continue;

      const src = htmlContent.substring(srcAttrStart, closingQuoteIndex);

      if (src.startsWith('data:') || src.startsWith('cid:')) {
        if (src.startsWith('data:')) {
          try {
            const [header, data] = src.split(',');
            const mimeMatch = header.match(/data:([^;]+)/);
            const defaultMime = tagType === 'video' ? 'video/mp4' : 'image/png';
            const mimeType = mimeMatch ? mimeMatch[1] : defaultMime;

            if (data.length > 5 * 1024 * 1024) continue;

            const imageBuffer = Buffer.from(data, 'base64');
            const extension = mimeType.split('/')[1] || (tagType === 'video' ? 'mp4' : 'png');
            const prefix = tagType === 'video' ? 'inline-video' : 'inline-image';
            const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;

            inlineImages.push({ src, mimeType, data: imageBuffer, filename });
          } catch (error: any) {
            console.error(`[Extract Images] Error parsing data URI:`, error.message);
          }
        } else if (src.startsWith('cid:')) {
          const cidFromSrc = src.replace('cid:', '').trim();
          const normalizedCidFromSrc = cidFromSrc.replace(/^<|>$/g, '').trim();

          if (parsedAttachments) {
            const attachment = parsedAttachments.find((att) => {
              if (!att.cid) return false;
              const normalizedAttCid = String(att.cid).replace(/^<|>$/g, '').trim();
              return (
                normalizedAttCid === normalizedCidFromSrc ||
                normalizedAttCid === cidFromSrc ||
                att.cid === cidFromSrc ||
                String(att.cid).includes(normalizedCidFromSrc) ||
                normalizedCidFromSrc.includes(normalizedAttCid)
              );
            });

            if (attachment && attachment.content) {
              const mimeType = attachment.contentType || 'image/png';
              const filename = attachment.filename ||
                `inline-image-${normalizedCidFromSrc}.${mimeType.split('/')[1] || 'png'}`;

              inlineImages.push({
                src, cid: normalizedCidFromSrc, mimeType,
                data: Buffer.from(attachment.content), filename,
              });
            }
          }
        }
      }
    }
  } catch (error: any) {
    console.error(`[Extract Images] Error during extraction:`, error.message);
  }

  return inlineImages;
}

/**
 * Process inline images: upload to Mega and replace src in HTML
 */
export async function processInlineImages(
  htmlContent: string | null,
  emailId: string,
  parsedAttachments?: Array<{
    cid?: string;
    contentType?: string;
    content?: Buffer;
    filename?: string;
  }>,
): Promise<{
  processedHtml: string | null;
  uploadedImages: Array<{
    filename: string;
    mimeType: string;
    size: number;
    fileUrl: string;
    fileHandle: string;
  }>;
}> {
  if (!htmlContent) {
    return { processedHtml: null, uploadedImages: [] };
  }

  const inlineImages = extractInlineImagesFromHtml(htmlContent, parsedAttachments);

  if (inlineImages.length === 0) {
    return { processedHtml: htmlContent, uploadedImages: [] };
  }

  let processedHtml = htmlContent;
  const uploadedImages: Array<{
    filename: string;
    mimeType: string;
    size: number;
    fileUrl: string;
    fileHandle: string;
  }> = [];

  for (let i = 0; i < inlineImages.length; i++) {
    const image = inlineImages[i];
    try {
      const uploadResult = await uploadEmailAttachmentToMega(
        image.data, image.filename, image.mimeType, emailId,
      );

      let replaced = false;

      if (image.src.startsWith('data:')) {
        const dataUriPrefix = image.src.substring(0, Math.min(100, image.src.length));
        const tagPattern = /<(img|video)([^>]*?)>/gi;
        let match;
        const tags: Array<{ fullTag: string; tagType: string; attributes: string; index: number }> = [];

        while ((match = tagPattern.exec(processedHtml)) !== null) {
          tags.push({ fullTag: match[0], tagType: match[1], attributes: match[2], index: match.index });
        }

        for (const tag of tags) {
          if (tag.attributes.includes(dataUriPrefix) || tag.attributes.includes(image.src.substring(0, 50))) {
            const srcPattern = /src=[\"']([^\"']+)[\"']/i;
            const newAttributes = tag.attributes.replace(srcPattern, `src="${uploadResult.fileUrl}"`);
            const newTag = `<${tag.tagType}${newAttributes}>`;
            processedHtml = processedHtml.substring(0, tag.index) + newTag + processedHtml.substring(tag.index + tag.fullTag.length);
            replaced = true;
            break;
          }
        }
      } else if (image.src.startsWith('cid:')) {
        const cidValue = image.src.replace('cid:', '').trim();
        const cidPattern = new RegExp(
          `(<(?:img|video)([^>]*?)src=[\"']cid:${cidValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\"'][^>]*?)>)`, 'gi'
        );
        processedHtml = processedHtml.replace(cidPattern, (match) => {
          replaced = true;
          return match.replace(/src=[\"']cid:[^\"']+[\"']/i, `src="${uploadResult.fileUrl}"`);
        });
      }

      if (!replaced && processedHtml.includes(image.src)) {
        processedHtml = processedHtml.replace(image.src, uploadResult.fileUrl);
      }

      uploadedImages.push({
        filename: image.filename, mimeType: image.mimeType,
        size: image.data.length, fileUrl: uploadResult.fileUrl,
        fileHandle: uploadResult.fileHandle,
      });
    } catch (error: any) {
      console.error(`[Inline Images] Failed to upload ${image.filename}:`, error.message);
    }
  }

  return { processedHtml, uploadedImages };
}
