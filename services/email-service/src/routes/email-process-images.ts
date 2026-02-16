import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { processInlineImages } from '../services/email-inline-images';
import { randomUUID } from 'crypto';

export const emailProcessImagesRouter = Router();

emailProcessImagesRouter.post('/:id/process-images', authMiddleware, async (req: Request, res: Response) => {
  try {
    const emailId = req.params.id;
    if (!emailId) return res.status(400).json({ success: false, error: 'Email ID is required', processedHtml: null, uploadedImages: [] });

    const email = await prisma.email.findUnique({
      where: { id: emailId },
      select: { id: true, htmlContent: true, EmailAttachment: true },
    });

    if (!email) return res.status(404).json({ success: false, error: 'Email not found', processedHtml: null, uploadedImages: [] });

    const hasDataUris = email.htmlContent?.includes('data:image/') || email.htmlContent?.includes('data:video/');
    const hasCidReferences = email.htmlContent?.includes('cid:') || false;

    const existingImageAttachments = email.EmailAttachment?.filter(att =>
      att.mimeType?.startsWith('image/') || att.mimeType?.startsWith('video/')
    ) || [];

    if (!hasDataUris && !hasCidReferences) {
      const hasMegaUrls = email.htmlContent?.includes('/api/storage/mega/');
      if (hasMegaUrls || existingImageAttachments.length > 0) {
        return res.json({ success: true, message: 'Images already processed', processedHtml: email.htmlContent, uploadedImages: [] });
      }
      return res.json({ success: true, message: 'No inline images to process', processedHtml: email.htmlContent, uploadedImages: [] });
    }

    // Handle CID references
    if (hasCidReferences && !hasDataUris) {
      const imageAttachments = existingImageAttachments.filter(att => att.fileUrl);

      if (imageAttachments.length > 0 && email.htmlContent) {
        let processedHtml = email.htmlContent;
        let replacedCount = 0;

        const cidRegex = /<(img|video)[^>]+src=["']cid:([^"']+)["'][^>]*>/gi;
        const cidMatches = Array.from(processedHtml.matchAll(cidRegex));

        cidMatches.forEach((match, index) => {
          const fullMatch = match[0];
          const tagType = match[1];
          let attachment: typeof imageAttachments[0] | undefined = imageAttachments[index];

          if (!attachment) {
            attachment = imageAttachments.find(att => {
              const isRightType = tagType === 'video'
                ? att.mimeType?.startsWith('video/')
                : att.mimeType?.startsWith('image/');
              return isRightType && att.fileUrl;
            });
          }

          if (attachment?.fileUrl) {
            processedHtml = processedHtml!.replace(fullMatch, fullMatch.replace(/src=["']cid:[^"']+["']/, `src="${attachment.fileUrl}"`));
            replacedCount++;
          }
        });

        if (replacedCount > 0) {
          await prisma.email.update({ where: { id: email.id }, data: { htmlContent: processedHtml } });
          return res.json({ success: true, message: `Resolved ${replacedCount} CID reference(s)`, processedHtml, uploadedImages: [] });
        }
      }

      return res.json({ success: true, message: 'CID references found but cannot be resolved.', processedHtml: email.htmlContent, uploadedImages: [] });
    }

    // Process data URI images
    let processedHtml: string | null = null;
    let uploadedImages: Array<{ filename: string; mimeType: string; size: number; fileUrl: string; fileHandle: string }> = [];

    try {
      const result = await processInlineImages(email.htmlContent, emailId);
      processedHtml = result.processedHtml;
      uploadedImages = result.uploadedImages;
    } catch (error: any) {
      console.error('[Process Images] Error:', error.message);
      processedHtml = email.htmlContent;
    }

    const finalProcessedHtml = processedHtml || email.htmlContent || '';

    const newAttachments = [];
    for (const image of uploadedImages) {
      if (!image.fileUrl || !image.fileHandle) continue;
      const existing = existingImageAttachments.find(att => att.fileUrl === image.fileUrl);
      if (!existing) {
        try {
          await prisma.emailAttachment.create({
            data: {
              id: randomUUID(), emailId: email.id,
              filename: image.filename, mimeType: image.mimeType,
              size: image.size, fileUrl: image.fileUrl, fileHandle: image.fileHandle,
            },
          });
          newAttachments.push(image);
        } catch {}
      }
    }

    if (finalProcessedHtml !== email.htmlContent) {
      try {
        await prisma.email.update({
          where: { id: email.id },
          data: { htmlContent: finalProcessedHtml, hasAttachments: (email.EmailAttachment?.length || 0) + newAttachments.length > 0 },
        });
      } catch {}
    }

    const message = uploadedImages.length > 0
      ? `Processed ${uploadedImages.length} inline image(s)`
      : 'No images to process';

    res.json({ success: true, message, processedHtml: finalProcessedHtml, uploadedImages: newAttachments });
  } catch (error: any) {
    console.error('[Process Images] Error:', error);
    res.status(500).json({ success: false, error: error.message || 'Failed to process inline images', processedHtml: null, uploadedImages: [] });
  }
});
