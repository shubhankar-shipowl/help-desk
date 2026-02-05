import { uploadEmailAttachmentToMega } from './storage/mega';
import { randomUUID } from 'crypto';

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
  if (!htmlContent) {
    console.log('   ℹ️  [Extract Images] No HTML content provided');
    return [];
  }

  console.log(
    '   🔍 [Extract Images] Scanning HTML for inline images/videos...',
  );
  console.log('   - HTML content length:', htmlContent.length, 'chars');

  // Skip processing if HTML is extremely large (over 5MB) to avoid stack overflow
  const MAX_HTML_SIZE = 5 * 1024 * 1024; // 5MB
  if (htmlContent.length > MAX_HTML_SIZE) {
    console.warn(
      `   ⚠️  [Extract Images] HTML too large (${(htmlContent.length / 1024 / 1024).toFixed(2)} MB), skipping inline image extraction to avoid stack overflow`,
    );
    return [];
  }

  const inlineImages: InlineImage[] = [];

  // For large HTML files, use a more memory-efficient approach
  // Instead of regex on the entire string, search for specific patterns in chunks
  try {
    // First, find all potential img/video tags using a simpler search
    const tagPattern = /<(img|video)/gi;
    const tagPositions: Array<{ index: number; tagType: string }> = [];
    let tagMatch: RegExpExecArray | null;

    // Find all tag positions first (lighter operation)
    while ((tagMatch = tagPattern.exec(htmlContent)) !== null) {
      tagPositions.push({
        index: tagMatch.index,
        tagType: tagMatch[1].toLowerCase(),
      });
      // Prevent infinite loops
      if (tagMatch.index === tagPattern.lastIndex) {
        tagPattern.lastIndex++;
      }
    }

    console.log(
      `   - Found ${tagPositions.length} potential image/video tag(s) in HTML`,
    );

    // Now extract src from each tag individually (more memory efficient)
    for (let i = 0; i < tagPositions.length; i++) {
      const { index, tagType } = tagPositions[i];

      // For data URIs, we need to handle potentially very large src values (50KB+ base64 images)
      // Instead of fixed chunk size, find the actual end of the src attribute
      const chunkStart = Math.max(0, index);

      // First, get a small chunk to find the start of the src attribute
      const initialChunkEnd = Math.min(htmlContent.length, index + 500);
      const initialChunk = htmlContent.substring(chunkStart, initialChunkEnd);

      // Find where src= starts
      const srcStartMatch = initialChunk.match(/src=["']/i);
      if (!srcStartMatch) {
        continue; // No src attribute found
      }

      const srcAttrStart = chunkStart + srcStartMatch.index! + srcStartMatch[0].length;
      const quoteChar = srcStartMatch[0].slice(-1); // Get the quote character (" or ')

      // Now search for the closing quote - handle large data URIs (up to 2MB)
      const maxSrcLength = 2 * 1024 * 1024; // 2MB max for src value
      const searchEnd = Math.min(htmlContent.length, srcAttrStart + maxSrcLength);

      // Find the closing quote
      let closingQuoteIndex = -1;
      for (let j = srcAttrStart; j < searchEnd; j++) {
        if (htmlContent[j] === quoteChar) {
          closingQuoteIndex = j;
          break;
        }
      }

      if (closingQuoteIndex === -1) {
        console.log(`   [${i + 1}/${tagPositions.length}] Could not find closing quote for src attribute, skipping`);
        continue;
      }

      const src = htmlContent.substring(srcAttrStart, closingQuoteIndex);

      console.log(
        `   [${i + 1}/${tagPositions.length}] Found ${tagType} tag with src length: ${src.length}, starts with: ${src.substring(0, 50)}...`,
      );

      // Only process data URIs and CID references (skip regular URLs)
      if (src.startsWith('data:') || src.startsWith('cid:')) {
          console.log(
            `   [${i + 1}/${tagPositions.length}] Processing inline image/video: ${src.substring(0, 80)}${src.length > 80 ? '...' : ''}`,
          );

          // Handle data URIs (base64 images/videos)
          if (src.startsWith('data:')) {
            try {
              console.log(`      - Processing data URI...`);
              const [header, data] = src.split(',');
              const mimeMatch = header.match(/data:([^;]+)/);
              const defaultMime =
                tagType === 'video' ? 'video/mp4' : 'image/png';
              const mimeType = mimeMatch ? mimeMatch[1] : defaultMime;

              console.log(`      - MIME type: ${mimeType}`);
              console.log(`      - Data length: ${data.length} chars (base64)`);

              // Skip if data URI is too large (over 5MB) to avoid memory issues
              if (data.length > 5 * 1024 * 1024) {
                console.warn(
                  `      ⚠️  Data URI too large (${(data.length / 1024 / 1024).toFixed(2)} MB), skipping`,
                );
                continue;
              }

              // Decode base64
              const imageBuffer = Buffer.from(data, 'base64');
              console.log(
                `      - Decoded size: ${(imageBuffer.length / 1024).toFixed(2)} KB`,
              );

              // Generate filename
              const extension =
                mimeType.split('/')[1] || (tagType === 'video' ? 'mp4' : 'png');
              const prefix =
                tagType === 'video' ? 'inline-video' : 'inline-image';
              const filename = `${prefix}-${Date.now()}-${Math.random().toString(36).substring(7)}.${extension}`;

              inlineImages.push({
                src,
                mimeType,
                data: imageBuffer,
                filename,
              });
              console.log(`      ✅ Extracted: ${filename}`);
            } catch (error: any) {
              console.error(
                `      ❌ [Extract Images] Error parsing data URI:`,
                error.message,
              );
              console.error(`      Error stack:`, error.stack);
            }
          }
          // Handle CID references (Content-ID)
          else if (src.startsWith('cid:')) {
            console.log(`      - Processing CID reference...`);
            const cidFromSrc = src.replace('cid:', '').trim();
            // Normalize CID: remove angle brackets and whitespace for matching
            const normalizedCidFromSrc = cidFromSrc
              .replace(/^<|>$/g, '')
              .trim();

            console.log(`      - CID from src: ${cidFromSrc}`);
            console.log(`      - Normalized CID: ${normalizedCidFromSrc}`);

            // Find matching attachment by CID
            if (parsedAttachments) {
              console.log(
                `      - Searching in ${parsedAttachments.length} parsed attachment(s)...`,
              );
              const attachment = parsedAttachments.find((att) => {
                if (!att.cid) return false;
                // Normalize attachment CID for comparison
                const normalizedAttCid = String(att.cid)
                  .replace(/^<|>$/g, '')
                  .trim();
                // Match exact CID or CID without angle brackets
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
                const filename =
                  attachment.filename ||
                  `inline-image-${normalizedCidFromSrc}.${mimeType.split('/')[1] || 'png'}`;

                console.log(
                  `      ✅ Found matching attachment: ${filename} (${mimeType})`,
                );
                console.log(
                  `      - Attachment size: ${(Buffer.from(attachment.content).length / 1024).toFixed(2)} KB`,
                );

                inlineImages.push({
                  src,
                  cid: normalizedCidFromSrc,
                  mimeType,
                  data: Buffer.from(attachment.content),
                  filename,
                });
              } else {
                console.warn(
                  `      ⚠️  [Extract Images] CID reference not found: ${cidFromSrc} (normalized: ${normalizedCidFromSrc})`,
                );
                if (parsedAttachments.length > 0) {
                  console.log(
                    `      Available CIDs:`,
                    parsedAttachments.map((a) => a.cid).filter(Boolean),
                  );
                } else {
                  console.log(`      No parsed attachments provided`);
                }
              }
            } else {
              console.warn(
                `      ⚠️  [Extract Images] CID reference found but no parsedAttachments provided: ${cidFromSrc}`,
              );
            }
          }
      }
    }
  } catch (error: any) {
    console.error(
      `   ❌ [Extract Images] Error during extraction:`,
      error.message,
    );
    console.error(`   Error stack:`, error.stack);
    // Return what we have so far instead of failing completely
  }

  console.log(
    `   ✅ [Extract Images] Extraction complete: ${inlineImages.length} image(s) extracted`,
  );
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

  // Extract inline images
  const inlineImages = extractInlineImagesFromHtml(
    htmlContent,
    parsedAttachments,
  );

  if (inlineImages.length === 0) {
    return { processedHtml: htmlContent, uploadedImages: [] };
  }

  console.log(
    `\n🖼️  [Inline Images] Found ${inlineImages.length} inline image(s) in email ${emailId}`,
  );
  inlineImages.forEach((img, idx) => {
    console.log(
      `   ${idx + 1}. ${img.filename} (${img.mimeType}) - ${(img.data.length / 1024).toFixed(2)} KB`,
    );
    if (img.cid) {
      console.log(`      CID: ${img.cid}`);
    }
  });

  // Upload images to Mega and replace src in HTML
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
      console.log(
        `\n📤 [Inline Images] [${i + 1}/${inlineImages.length}] Uploading to Mega: ${image.filename}`,
      );
      console.log(`   - Size: ${(image.data.length / 1024).toFixed(2)} KB`);
      console.log(`   - MIME type: ${image.mimeType}`);

      // Upload to Mega
      const uploadResult = await uploadEmailAttachmentToMega(
        image.data,
        image.filename,
        image.mimeType,
        emailId,
      );

      console.log(`   ✅ Upload successful: ${uploadResult.fileUrl}`);

      // Replace src in HTML (handle both img and video tags)
      // Use a more efficient approach: find the tag and replace just the src attribute
      // This avoids creating huge regex patterns with very long data URIs
      let replaced = false;

      // Try to find the tag with this src using a more efficient method
      // First, try to find the tag by searching for the beginning of the src value
      // Since data URIs start with "data:", we can search for that
      if (image.src.startsWith('data:')) {
        // For data URIs, find the tag by searching for the data URI prefix
        // We'll search for the tag structure and replace the entire src attribute
        const dataUriPrefix = image.src.substring(
          0,
          Math.min(100, image.src.length),
        ); // Use first 100 chars for search
        const tagPattern = /<(img|video)([^>]*?)>/gi;
        let match;
        const tags: Array<{
          fullTag: string;
          tagType: string;
          attributes: string;
          index: number;
        }> = [];

        // Find all img/video tags
        while ((match = tagPattern.exec(processedHtml)) !== null) {
          tags.push({
            fullTag: match[0],
            tagType: match[1],
            attributes: match[2],
            index: match.index,
          });
        }

        // Check each tag to see if it has our src
        for (const tag of tags) {
          // Check if this tag contains our src (check for data: prefix match)
          if (
            tag.attributes.includes(dataUriPrefix) ||
            tag.attributes.includes(image.src.substring(0, 50))
          ) {
            // Replace the src attribute in this tag
            const srcPattern = /src=["']([^"']+)["']/i;
            const newAttributes = tag.attributes.replace(
              srcPattern,
              `src="${uploadResult.fileUrl}"`,
            );
            const newTag = `<${tag.tagType}${newAttributes}>`;
            processedHtml =
              processedHtml.substring(0, tag.index) +
              newTag +
              processedHtml.substring(tag.index + tag.fullTag.length);
            replaced = true;
            break;
          }
        }
      } else if (image.src.startsWith('cid:')) {
        // For CID references, use a simpler regex since they're shorter
        const cidValue = image.src.replace('cid:', '').trim();
        const cidPattern = new RegExp(
          `(<(?:img|video)([^>]*?)src=["']cid:${cidValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(["'][^>]*?)>)`,
          'gi',
        );
        processedHtml = processedHtml.replace(
          cidPattern,
          (match, p1, p2, p3) => {
            replaced = true;
            return match.replace(
              /src=["']cid:[^"']+["']/i,
              `src="${uploadResult.fileUrl}"`,
            );
          },
        );
      }

      if (replaced) {
        console.log(
          `   ✅ Replaced src in HTML: ${image.src.substring(0, 50)}... -> ${uploadResult.fileUrl}`,
        );
      } else {
        console.warn(
          `   ⚠️  Could not find and replace src in HTML: ${image.src.substring(0, 50)}...`,
        );
        // Fallback: try simple string replacement for the entire src value
        if (processedHtml.includes(image.src)) {
          processedHtml = processedHtml.replace(
            image.src,
            uploadResult.fileUrl,
          );
          replaced = true;
          console.log(`   ✅ Used fallback string replacement`);
        }
      }

      uploadedImages.push({
        filename: image.filename,
        mimeType: image.mimeType,
        size: image.data.length,
        fileUrl: uploadResult.fileUrl,
        fileHandle: uploadResult.fileHandle,
      });
    } catch (error: any) {
      console.error(
        `   ❌ [Inline Images] Failed to upload ${image.filename}:`,
        error.message,
      );
      console.error(`   Error stack:`, error.stack);
      // Continue with other images even if one fails
    }
  }

  console.log(
    `\n✅ [Inline Images] Processing complete: ${uploadedImages.length}/${inlineImages.length} images uploaded`,
  );

  return { processedHtml, uploadedImages };
}
