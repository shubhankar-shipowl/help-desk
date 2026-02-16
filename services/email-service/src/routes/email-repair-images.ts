import { Router, Request, Response } from 'express';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import { processInlineImages } from '../services/email-inline-images';
import { randomUUID } from 'crypto';

export const emailRepairImagesRouter = Router();

// Track in-progress repair jobs: emailId → status
const repairJobs = new Map<string, { status: 'processing' | 'done' | 'error'; message?: string; processedHtml?: string; uploadedImages?: any[] }>();

/**
 * POST /emails/:id/repair-images
 *
 * Kicks off a background job to re-fetch the email from IMAP,
 * re-process inline images (upload to MEGA), and update the DB.
 * Returns immediately with { status: 'processing' }.
 */
emailRepairImagesRouter.post('/:id/repair-images', authMiddleware, async (req: Request, res: Response) => {
  const emailId = req.params.id;
  if (!emailId) return res.status(400).json({ success: false, error: 'Email ID is required' });

  // If already processing, return current status
  const existing = repairJobs.get(emailId);
  if (existing?.status === 'processing') {
    return res.json({ success: true, status: 'processing', message: 'Repair already in progress' });
  }

  try {
    // 1. Validate the email exists and get credentials (fast DB queries)
    const email = await prisma.email.findUnique({
      where: { id: emailId },
      select: {
        id: true,
        messageId: true,
        tenantId: true,
        storeId: true,
        htmlContent: true,
        fromEmail: true,
        toEmail: true,
        EmailAttachment: true,
      },
    });

    if (!email) return res.status(404).json({ success: false, error: 'Email not found' });

    // 2. Get IMAP credentials
    let settings = await prisma.systemSettings.findMany({
      where: {
        tenantId: email.tenantId,
        storeId: email.storeId || null,
        key: { in: ['IMAP_EMAIL', 'IMAP_APP_PASSWORD'] },
      },
    });

    const hasImapEmail = settings.some(s => s.key === 'IMAP_EMAIL');
    const hasImapPassword = settings.some(s => s.key === 'IMAP_APP_PASSWORD');

    if ((!hasImapEmail || !hasImapPassword) && email.storeId) {
      const tenantSettings = await prisma.systemSettings.findMany({
        where: {
          tenantId: email.tenantId,
          storeId: null,
          key: { in: ['IMAP_EMAIL', 'IMAP_APP_PASSWORD'] },
        },
      });
      const existingKeys = new Set(settings.map(s => s.key));
      tenantSettings.forEach(s => {
        if (!existingKeys.has(s.key)) settings.push(s);
      });
    }

    const configMap: Record<string, string> = {};
    settings.forEach(s => { configMap[s.key] = s.value; });

    const imapEmail = configMap.IMAP_EMAIL;
    const imapAppPassword = configMap.IMAP_APP_PASSWORD;

    if (!imapEmail || !imapAppPassword) {
      return res.status(400).json({
        success: false,
        error: 'IMAP credentials not configured. Cannot re-fetch email from server.',
      });
    }

    // 3. Return immediately — process in background
    repairJobs.set(emailId, { status: 'processing' });
    res.json({ success: true, status: 'processing', message: 'Repair started. Images will be updated shortly.' });

    // 4. Fire-and-forget: IMAP fetch + MEGA upload in background
    (async () => {
      try {
        console.log(`[Repair Images] Re-fetching email ${emailId} (messageId: ${email.messageId}) from IMAP...`);

        const rawBuffer = await fetchSingleEmailByMessageId(imapEmail, imapAppPassword, email.messageId);

        if (!rawBuffer) {
          console.warn(`[Repair Images] Email not found on mail server: ${emailId}`);
          repairJobs.set(emailId, { status: 'error', message: 'Email not found on mail server' });
          return;
        }

        const parsed = await simpleParser(rawBuffer);

        if (!parsed.html) {
          repairJobs.set(emailId, { status: 'done', message: 'No HTML content to repair', processedHtml: email.htmlContent || undefined, uploadedImages: [] });
          return;
        }

        // Resolve CID references to data URIs
        let html = parsed.html;
        const inlineAttachments = (parsed.attachments || []).filter(a => a.contentDisposition === 'inline');

        for (const att of inlineAttachments) {
          if (att.cid && att.content) {
            const escapedCid = att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const cidPattern = new RegExp(`cid:${escapedCid}`, 'gi');
            const dataUri = `data:${att.contentType || 'image/png'};base64,${att.content.toString('base64')}`;
            html = html.replace(cidPattern, dataUri);
          }
        }

        console.log(`[Repair Images] Uploading inline images to MEGA for email ${emailId}...`);

        // Upload inline images to MEGA
        const result = await processInlineImages(html, emailId, inlineAttachments.map(a => ({
          cid: a.cid,
          contentType: a.contentType,
          content: a.content,
          filename: a.filename,
        })));

        const processedHtml = result.processedHtml || html;
        const uploadedImages = result.uploadedImages;

        // Create EmailAttachment records
        const existingUrls = new Set(email.EmailAttachment.map(a => a.fileUrl).filter(Boolean));
        const newAttachments: typeof uploadedImages = [];

        for (const img of uploadedImages) {
          if (!img.fileUrl || existingUrls.has(img.fileUrl)) continue;
          try {
            await prisma.emailAttachment.create({
              data: {
                id: randomUUID(),
                emailId,
                filename: img.filename,
                mimeType: img.mimeType,
                size: img.size,
                fileUrl: img.fileUrl,
                fileHandle: img.fileHandle,
              },
            });
            newAttachments.push(img);
          } catch { /* ignore duplicates */ }
        }

        // Update the email HTML in the database
        if (processedHtml !== email.htmlContent) {
          await prisma.email.update({
            where: { id: emailId },
            data: {
              htmlContent: processedHtml,
              hasAttachments: (email.EmailAttachment.length + newAttachments.length) > 0,
            },
          });
        }

        console.log(`[Repair Images] Done: ${newAttachments.length} images uploaded to MEGA for email ${emailId}`);
        repairJobs.set(emailId, { status: 'done', message: `Repaired ${newAttachments.length} image(s)`, processedHtml, uploadedImages: newAttachments });

        // Clean up job after 5 minutes
        setTimeout(() => repairJobs.delete(emailId), 5 * 60 * 1000);
      } catch (error: any) {
        console.error('[Repair Images] Background error:', error.message);
        repairJobs.set(emailId, { status: 'error', message: error.message || 'Failed to repair images' });
        setTimeout(() => repairJobs.delete(emailId), 2 * 60 * 1000);
      }
    })();

  } catch (error: any) {
    console.error('[Repair Images] Error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ success: false, error: error.message || 'Failed to repair images' });
    }
  }
});

/**
 * GET /emails/:id/repair-images
 *
 * Poll the status of a repair job.
 */
emailRepairImagesRouter.get('/:id/repair-images', authMiddleware, async (req: Request, res: Response) => {
  const emailId = req.params.id;
  const job = repairJobs.get(emailId);

  if (!job) {
    return res.json({ success: true, status: 'idle' });
  }

  if (job.status === 'done') {
    const result = {
      success: true,
      status: 'done',
      message: job.message,
      processedHtml: job.processedHtml,
      uploadedImages: job.uploadedImages || [],
    };
    return res.json(result);
  }

  if (job.status === 'error') {
    return res.json({ success: false, status: 'error', error: job.message });
  }

  res.json({ success: true, status: 'processing' });
});

/**
 * Fetch a single email from Gmail IMAP by its Message-ID header.
 * Returns the raw RFC2822 buffer, or null if not found.
 */
function fetchSingleEmailByMessageId(
  user: string,
  password: string,
  messageId: string,
): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const imap = new Imap({
      user,
      password,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 30000,
      authTimeout: 30000,
    });

    let settled = false;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      settle(() => {
        safeDestroy(imap);
        reject(new Error('IMAP connection timeout while fetching single email'));
      });
    }, 90000);

    imap.on('error', (err: any) => {
      settle(() => {
        safeDestroy(imap);
        reject(err);
      });
    });

    imap.once('ready', () => {
      const tryBox = (boxName: string, fallback?: string) => {
        imap.openBox(boxName, true, (err) => {
          if (err && fallback) {
            tryBox(fallback);
            return;
          }
          if (err) {
            settle(() => { safeDestroy(imap); reject(err); });
            return;
          }

          const headerSearch = ['HEADER', 'MESSAGE-ID', messageId];
          imap.search([headerSearch], (searchErr, results) => {
            if (searchErr || !results || results.length === 0) {
              settle(() => { safeDestroy(imap); resolve(null); });
              return;
            }

            const uid = results[results.length - 1];
            const fetcher = imap.fetch([uid], { bodies: '' });
            let emailBuffer: Buffer | null = null;

            fetcher.on('message', (msg) => {
              const chunks: Buffer[] = [];
              msg.on('body', (stream) => {
                stream.on('data', (chunk: Buffer) => { chunks.push(chunk); });
                stream.once('end', () => {
                  try {
                    if (chunks.length > 0) emailBuffer = Buffer.concat(chunks);
                  } catch { /* ignore */ }
                });
              });
            });

            fetcher.on('error', () => {
              settle(() => { safeDestroy(imap); resolve(null); });
            });

            fetcher.once('end', () => {
              settle(() => { safeDestroy(imap); resolve(emailBuffer); });
            });
          });
        });
      };

      tryBox('[Gmail]/All Mail', 'INBOX');
    });

    imap.connect();
  });
}

function safeDestroy(imap: Imap): void {
  try {
    imap.removeAllListeners();
    imap.end();
  } catch { /* ignore */ }
}
