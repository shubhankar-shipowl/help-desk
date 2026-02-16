import Imap from 'imap';
import { simpleParser, ParsedMail } from 'mailparser';
import { prisma } from '../config/database';
import { findOrCreateThreadId, extractThreadHeaders } from './email-threading';
import { uploadEmailAttachmentToMega } from './mega-storage';
import { processInlineImages } from './email-inline-images';
import { randomUUID } from 'crypto';

export interface GmailImapConfig {
  email: string;
  appPassword: string;
  tenantId: string;
  storeId?: string | null;
}

export interface FetchOptions {
  mode: 'unread' | 'latest' | 'recent';
  limit?: number;
}

export interface EmailAttachmentData {
  filename: string;
  mimeType: string;
  size: number;
  content: Buffer;
}

export interface FetchedEmail {
  messageId: string;
  fromEmail: string;
  fromName: string | null;
  toEmail: string;
  subject: string;
  date: Date;
  textContent: string | null;
  htmlContent: string | null;
  headers: Record<string, any>;
  hasAttachments: boolean;
  attachments: EmailAttachmentData[];
  inlineAttachments?: Array<{
    cid?: string;
    contentType?: string;
    content?: Buffer;
    filename?: string;
  }>;
}

const BATCH_SIZE = 100;

function createImapConnection(config: GmailImapConfig): Imap {
  return new Imap({
    user: config.email,
    password: config.appPassword,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 30000,
    authTimeout: 30000,
  });
}

/** Safely destroy an IMAP connection, suppressing all further errors */
function safeDestroyImap(imap: Imap): void {
  try {
    imap.removeAllListeners();
    imap.end();
  } catch {
    // ignore - connection already closed
  }
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  delayMs: number = 2000,
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`[IMAP] Attempt ${attempt}/${maxAttempts}...`);
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error.message || error.toString();

      if (errorMsg.includes('Invalid credentials') || errorMsg.includes('authentication')) {
        throw error;
      }

      console.error(`[IMAP] Attempt ${attempt} failed: ${errorMsg}`);

      if (attempt < maxAttempts) {
        console.log(`[IMAP] Retrying in ${delayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  throw lastError || new Error('Max retries exceeded');
}

async function getEmailIds(config: GmailImapConfig, options: FetchOptions): Promise<number[]> {
  return withRetry(() => getEmailIdsInternal(config, options), 3, 3000);
}

async function getEmailIdsInternal(config: GmailImapConfig, options: FetchOptions): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection(config);
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const timeout = setTimeout(() => {
      settle(() => {
        safeDestroyImap(imap);
        reject(new Error('IMAP connection timeout'));
      });
    }, 60000);

    imap.on('error', (err: any) => {
      settle(() => {
        safeDestroyImap(imap);
        reject(err);
      });
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err, box) => {
        if (err) { settle(() => { safeDestroyImap(imap); reject(err); }); return; }

        console.log(`[IMAP] INBOX opened. Total: ${box.messages.total}`);

        let searchCriteria: any[];
        const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

        if (options.mode === 'recent') {
          const today = new Date();
          const formattedDate = `${today.getDate()}-${months[today.getMonth()]}-${today.getFullYear()}`;
          searchCriteria = [['SINCE', formattedDate]];
        } else if (options.mode === 'unread') {
          const sinceDate = new Date();
          sinceDate.setDate(sinceDate.getDate() - 90);
          const formattedDate = `${sinceDate.getDate()}-${months[sinceDate.getMonth()]}-${sinceDate.getFullYear()}`;
          searchCriteria = ['UNSEEN', ['SINCE', formattedDate]];
        } else {
          searchCriteria = ['ALL'];
        }

        imap.search(searchCriteria, (searchErr, results) => {
          safeDestroyImap(imap);
          if (searchErr) { settle(() => reject(searchErr)); return; }
          const emailIds = (results || []).sort((a, b) => b - a);
          console.log(`[IMAP] Found ${emailIds.length} emails`);
          settle(() => resolve(emailIds));
        });
      });
    });

    imap.connect();
  });
}

async function fetchBatchWithNewConnection(
  config: GmailImapConfig, emailIds: number[], batchNum: number, totalBatches: number,
): Promise<Map<number, Buffer>> {
  return new Promise((resolve) => {
    const imap = createImapConnection(config);
    const emailBuffers: Map<number, Buffer> = new Map();
    let settled = false;

    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    console.log(`[IMAP] Batch ${batchNum}/${totalBatches}: Fetching ${emailIds.length} emails...`);

    const timeout = setTimeout(() => {
      settle(() => {
        console.warn(`[IMAP] Batch ${batchNum} timed out after 90s`);
        safeDestroyImap(imap);
        resolve(emailBuffers);
      });
    }, 90000);

    imap.on('error', (err: any) => {
      console.error(`[IMAP] Batch ${batchNum} connection error:`, err?.message || err);
      settle(() => {
        safeDestroyImap(imap);
        resolve(emailBuffers);
      });
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) {
          settle(() => { safeDestroyImap(imap); resolve(emailBuffers); });
          return;
        }

        let messageIndex = 0;
        const messagePromises: Promise<void>[] = [];
        const fetch = imap.fetch(emailIds, { bodies: '', struct: true });

        fetch.on('message', (msg) => {
          const actualEmailId = emailIds[messageIndex];
          messageIndex++;

          const messagePromise = new Promise<void>((resolveMsg) => {
            let chunks: Buffer[] = [];
            msg.on('body', (stream) => {
              stream.on('data', (chunk: Buffer) => { chunks.push(chunk); });
              stream.once('end', () => {
                try {
                  if (chunks.length > 0) emailBuffers.set(actualEmailId, Buffer.concat(chunks));
                } catch { /* ignore concat errors */ }
                chunks = [];
              });
            });
            msg.once('end', () => resolveMsg());
            msg.on('error', () => resolveMsg());
          });

          messagePromises.push(messagePromise);
        });

        fetch.on('error', () => {
          settle(() => {
            safeDestroyImap(imap);
            resolve(emailBuffers);
          });
        });

        fetch.once('end', async () => {
          try {
            await Promise.all(messagePromises);
          } catch { /* ignore */ }
          settle(() => {
            console.log(`[IMAP] Batch ${batchNum}/${totalBatches}: Received ${emailBuffers.size} emails`);
            safeDestroyImap(imap);
            resolve(emailBuffers);
          });
        });
      });
    });

    imap.connect();
  });
}

export async function fetchGmailEmails(
  config: GmailImapConfig, options: FetchOptions = { mode: 'unread' },
): Promise<FetchedEmail[]> {
  console.log(`[IMAP] Connecting to Gmail for ${config.email}...`);

  let emailIds = await getEmailIds(config, options);

  if (emailIds.length === 0) { console.log('[IMAP] No emails found'); return []; }

  const MAX_EMAILS = 2000;
  if (options.mode === 'unread') {
    const UNREAD_LIMIT = options.limit || 200;
    if (emailIds.length > UNREAD_LIMIT) {
      console.log(`[IMAP] Limiting unread fetch to ${UNREAD_LIMIT} newest emails (found ${emailIds.length})`);
      emailIds = emailIds.slice(0, UNREAD_LIMIT);
    }
  } else if (options.mode === 'latest' && options.limit) {
    emailIds = emailIds.slice(0, Math.min(options.limit, MAX_EMAILS));
  } else if (emailIds.length > MAX_EMAILS) {
    emailIds = emailIds.slice(0, MAX_EMAILS);
  }

  const batches: number[][] = [];
  for (let i = 0; i < emailIds.length; i += BATCH_SIZE) {
    batches.push(emailIds.slice(i, i + BATCH_SIZE));
  }

  console.log(`[IMAP] Will fetch ${emailIds.length} emails in ${batches.length} batches`);

  const allEmailBuffers: Map<number, Buffer> = new Map();

  async function retryBatch(batchIndex: number, maxRetries: number = 3): Promise<Map<number, Buffer>> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const batchBuffers = await fetchBatchWithNewConnection(config, batches[batchIndex], batchIndex + 1, batches.length);
        if (batchBuffers.size > 0) return batchBuffers;
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      } catch (error: any) {
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    return new Map();
  }

  for (let i = 0; i < batches.length; i++) {
    const batchBuffers = await retryBatch(i);
    batchBuffers.forEach((buffer, emailId) => { allEmailBuffers.set(emailId, buffer); });

    console.log(`[IMAP] Progress: ${allEmailBuffers.size}/${emailIds.length} emails fetched`);

    if (i < batches.length - 1) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  if (allEmailBuffers.size === 0) return [];

  // Parse emails
  console.log(`[IMAP] Parsing ${allEmailBuffers.size} emails...`);
  const allParsedEmails: FetchedEmail[] = [];
  const entries = Array.from(allEmailBuffers.entries());

  const PARSE_BATCH_SIZE = 20;
  for (let i = 0; i < entries.length; i += PARSE_BATCH_SIZE) {
    const parseBatch = entries.slice(i, i + PARSE_BATCH_SIZE);
    const parsePromises = parseBatch.map(async ([seqno, buffer]) => {
      try {
        const parsed = await simpleParser(buffer);
        return parseEmailData(parsed, seqno);
      } catch { return null; }
    });
    const results = await Promise.all(parsePromises);
    allParsedEmails.push(...results.filter((e): e is FetchedEmail => e !== null));
  }

  console.log(`[IMAP] Parsed ${allParsedEmails.length} emails`);
  return allParsedEmails;
}

function parseEmailData(parsed: ParsedMail, seqno: number): FetchedEmail | null {
  try {
    let fromEmail = '';
    let fromName: string | null = null;

    if (parsed.from) {
      if (Array.isArray(parsed.from)) {
        fromEmail = parsed.from[0]?.value?.[0]?.address || '';
        fromName = parsed.from[0]?.value?.[0]?.name || null;
      } else {
        fromEmail = parsed.from.value?.[0]?.address || '';
        fromName = parsed.from.value?.[0]?.name || null;
      }
    }

    let toEmail = '';
    if (parsed.to) {
      if (Array.isArray(parsed.to)) {
        toEmail = parsed.to[0]?.value?.[0]?.address || '';
      } else {
        toEmail = parsed.to.value?.[0]?.address || parsed.to.text || '';
      }
    }

    const attachments: EmailAttachmentData[] = [];
    const inlineAttachments: Array<{ cid?: string; contentType?: string; content?: Buffer; filename?: string }> = [];

    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments) {
        if (att.contentDisposition === 'inline') {
          inlineAttachments.push({ cid: att.cid, contentType: att.contentType, content: att.content, filename: att.filename });
        } else {
          attachments.push({
            filename: att.filename || `attachment_${Date.now()}`,
            mimeType: att.contentType || 'application/octet-stream',
            size: att.size || att.content.length,
            content: att.content,
          });
        }
      }
    }

    // Convert headers Map to plain object for JSON serialization
    const headersObj: Record<string, any> = {};
    if (parsed.headers && typeof parsed.headers.forEach === 'function') {
      parsed.headers.forEach((value: any, key: string) => {
        headersObj[key] = value;
      });
    }

    return {
      messageId: parsed.messageId || `<${Date.now()}-${seqno}@gmail>`,
      fromEmail, fromName, toEmail,
      subject: parsed.subject || '(No Subject)',
      date: parsed.date || new Date(),
      textContent: parsed.text || null,
      htmlContent: parsed.html || null,
      headers: headersObj,
      hasAttachments: attachments.length > 0 || inlineAttachments.length > 0,
      attachments, inlineAttachments,
    };
  } catch { return null; }
}

function truncateContent(content: string | null, maxSize: number): string | null {
  if (!content) return null;
  const contentBytes = Buffer.byteLength(content, 'utf8');
  if (contentBytes <= maxSize) return content;

  // Always truncate — inline images are uploaded to MEGA in Phase 3
  // and the HTML is updated with short MEGA URLs afterwards.
  let truncated = content.substring(0, Math.floor(maxSize * 0.9));
  const lastTagEnd = truncated.lastIndexOf('>');
  const lastQuoteEnd = Math.max(truncated.lastIndexOf('"'), truncated.lastIndexOf("'"));
  const safeCutoff = Math.max(lastTagEnd, lastQuoteEnd);
  if (safeCutoff > maxSize * 0.5) truncated = truncated.substring(0, safeCutoff + 1);
  return truncated + '\n\n[Content truncated]';
}

async function uploadAttachmentsToMega(
  attachments: EmailAttachmentData[], emailId: string,
): Promise<{ filename: string; mimeType: string; size: number; fileUrl: string; fileHandle: string }[]> {
  const uploadedAttachments: { filename: string; mimeType: string; size: number; fileUrl: string; fileHandle: string }[] = [];

  const UPLOAD_CONCURRENCY = 3;
  for (let i = 0; i < attachments.length; i += UPLOAD_CONCURRENCY) {
    const batch = attachments.slice(i, i + UPLOAD_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (attachment) => {
        const result = await uploadEmailAttachmentToMega(
          attachment.content, attachment.filename, attachment.mimeType, emailId,
        );
        return { attachment, result };
      }),
    );
    for (const r of results) {
      if (r.status === 'fulfilled') {
        uploadedAttachments.push({
          filename: r.value.attachment.filename, mimeType: r.value.attachment.mimeType,
          size: r.value.attachment.size, fileUrl: r.value.result.fileUrl, fileHandle: r.value.result.fileHandle,
        });
      }
    }
  }

  return uploadedAttachments;
}

export async function fetchAndStoreGmailEmails(
  config: GmailImapConfig, options: FetchOptions = { mode: 'unread' },
): Promise<{ fetched: number; stored: number; errors: number; attachmentsUploaded: number }> {
  try {
    const fetchedEmails = await fetchGmailEmails(config, options);

    if (fetchedEmails.length === 0) {
      return { fetched: 0, stored: 0, errors: 0, attachmentsUploaded: 0 };
    }

    console.log(`[IMAP] Processing ${fetchedEmails.length} emails for storage...`);

    const messageIds = fetchedEmails.map((e) => e.messageId);
    const existingEmails = await prisma.email.findMany({
      where: { messageId: { in: messageIds } },
      select: { messageId: true, id: true, htmlContent: true, EmailAttachment: { select: { mimeType: true, fileUrl: true } } },
    });

    const existingSet = new Set(existingEmails.map((e) => e.messageId));
    const newEmails = fetchedEmails.filter((email) => !existingSet.has(email.messageId));

    console.log(`[IMAP] ${existingSet.size} already exist, ${newEmails.length} new`);

    if (newEmails.length === 0) {
      return { fetched: fetchedEmails.length, stored: 0, errors: 0, attachmentsUploaded: 0 };
    }

    const MAX_CONTENT_SIZE = 2 * 1024 * 1024;
    let stored = 0;
    let errors = 0;
    let attachmentsUploaded = 0;

    function resolveCidReferences(
      htmlContent: string | null,
      inlineAttachments?: Array<{ cid?: string; contentType?: string; content?: Buffer; filename?: string }>,
    ): string | null {
      if (!htmlContent || !inlineAttachments || inlineAttachments.length === 0) return htmlContent;
      let processed = htmlContent;
      for (const att of inlineAttachments) {
        if (att.cid && att.content) {
          const escapedCid = att.cid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const cidPattern = new RegExp(`cid:${escapedCid}`, 'gi');
          const dataUri = `data:${att.contentType || 'image/png'};base64,${att.content.toString('base64')}`;
          processed = processed.replace(cidPattern, dataUri);
        }
      }
      return processed;
    }

    /**
     * Prepare HTML for storage (fast, sync-like).
     * Resolves CID references and truncates if needed.
     * Inline image uploads to MEGA happen in Phase 2 (after DB insert).
     */
    function prepareHtmlForStorage(email: FetchedEmail): string | null {
      const html = resolveCidReferences(email.htmlContent, email.inlineAttachments);
      if (!html) return html;
      return truncateContent(html, MAX_CONTENT_SIZE);
    }

    /**
     * Check if the original email has inline images (CID or data URIs)
     * that should be uploaded to MEGA in Phase 3.
     */
    function hasInlineImages(email: FetchedEmail): boolean {
      // Has inline attachments with CID references
      if (email.inlineAttachments && email.inlineAttachments.length > 0) {
        return email.inlineAttachments.some(a => a.content && a.content.length > 200);
      }
      // Has data URIs directly in the HTML
      if (email.htmlContent) {
        return /data:(image|video)\/[^;]+;base64,[A-Za-z0-9+/=]{200,}/.test(email.htmlContent);
      }
      return false;
    }

    // PHASE 1: Store ALL emails to DB first (fast — no MEGA uploads)
    console.log(`[IMAP] Phase 1: Storing ${newEmails.length} emails to database...`);
    const emailsForMegaUpload: Array<{ dbEmailId: string; attachments: EmailAttachmentData[] }> = [];
    const emailsForInlineUpload: Array<{ dbEmailId: string; email: FetchedEmail }> = [];

    const DB_BATCH_SIZE = 10;
    for (let i = 0; i < newEmails.length; i += DB_BATCH_SIZE) {
      const batch = newEmails.slice(i, i + DB_BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (email) => {
          const emailId = randomUUID();
          const threadId = await findOrCreateThreadId(
            { messageId: email.messageId, subject: email.subject, fromEmail: email.fromEmail, toEmail: email.toEmail, headers: email.headers },
            config.tenantId, config.storeId || null,
          );

          const finalHtmlContent = prepareHtmlForStorage(email);

          await prisma.email.create({
            data: {
              id: emailId, tenantId: config.tenantId, storeId: config.storeId || null,
              messageId: email.messageId, threadId, fromEmail: email.fromEmail, fromName: email.fromName,
              toEmail: email.toEmail, subject: email.subject,
              textContent: truncateContent(email.textContent, MAX_CONTENT_SIZE),
              htmlContent: finalHtmlContent, headers: email.headers, read: false, processed: false,
              hasAttachments: email.attachments.length > 0 || !!(email.inlineAttachments?.length),
              createdAt: email.date, updatedAt: email.date,
            },
          });

          if (email.attachments.length > 0) {
            emailsForMegaUpload.push({ dbEmailId: emailId, attachments: email.attachments });
          }

          // Queue inline image upload for Phase 3 if email has inline images
          if (hasInlineImages(email)) {
            emailsForInlineUpload.push({ dbEmailId: emailId, email });
          }

          return emailId;
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') stored++;
        else if ((result.reason as any)?.code !== 'P2002') errors++;
      }

      if ((i + DB_BATCH_SIZE) % 100 === 0 || i + DB_BATCH_SIZE >= newEmails.length) {
        console.log(`[IMAP] Phase 1 progress: ${Math.min(i + DB_BATCH_SIZE, newEmails.length)}/${newEmails.length} stored`);
      }
    }

    console.log(`[IMAP] Phase 1 complete: ${stored} emails stored`);

    // PHASE 2 & 3: Upload attachments + inline images to MEGA in the BACKGROUND.
    // Return immediately so the client sees the new emails right away.
    const pendingAttachments = emailsForMegaUpload.length;
    const pendingInline = emailsForInlineUpload.length;

    if (pendingAttachments > 0 || pendingInline > 0) {
      console.log(`[IMAP] Starting background upload: ${pendingAttachments} attachment batches, ${pendingInline} inline image batches`);

      // Fire-and-forget: upload files in background
      (async () => {
        let bgAttachments = 0;

        // Phase 2: Regular attachments
        if (emailsForMegaUpload.length > 0) {
          console.log(`[IMAP BG] Phase 2: Uploading attachments for ${emailsForMegaUpload.length} emails...`);
          for (const { dbEmailId, attachments } of emailsForMegaUpload) {
            try {
              const uploaded = await uploadAttachmentsToMega(attachments, dbEmailId);
              for (const att of uploaded) {
                try {
                  await prisma.emailAttachment.create({
                    data: {
                      id: randomUUID(), emailId: dbEmailId,
                      filename: att.filename, mimeType: att.mimeType, size: att.size,
                      fileUrl: att.fileUrl, fileHandle: att.fileHandle,
                    },
                  });
                  bgAttachments++;
                } catch {}
              }
            } catch (error: any) {
              console.error(`[IMAP BG] MEGA upload error for email ${dbEmailId}:`, error.message);
            }
          }
          console.log(`[IMAP BG] Phase 2 complete: ${bgAttachments} attachments uploaded`);
        }

        // Phase 3: Inline images
        if (emailsForInlineUpload.length > 0) {
          console.log(`[IMAP BG] Phase 3: Uploading inline images for ${emailsForInlineUpload.length} emails...`);
          for (const { dbEmailId, email } of emailsForInlineUpload) {
            try {
              const html = resolveCidReferences(email.htmlContent, email.inlineAttachments);
              if (!html) continue;

              const result = await processInlineImages(html, dbEmailId, email.inlineAttachments);

              if (result.uploadedImages.length > 0) {
                for (const img of result.uploadedImages) {
                  try {
                    await prisma.emailAttachment.create({
                      data: {
                        id: randomUUID(), emailId: dbEmailId,
                        filename: img.filename, mimeType: img.mimeType, size: img.size,
                        fileUrl: img.fileUrl, fileHandle: img.fileHandle,
                      },
                    });
                    bgAttachments++;
                  } catch {}
                }

                if (result.processedHtml) {
                  await prisma.email.update({
                    where: { id: dbEmailId },
                    data: { htmlContent: result.processedHtml },
                  });
                }

                console.log(`[IMAP BG] Phase 3: Uploaded ${result.uploadedImages.length} inline images for email ${dbEmailId}`);
              }
            } catch (error: any) {
              console.error(`[IMAP BG] Phase 3 error for email ${dbEmailId}:`, error.message);
            }
          }
          console.log(`[IMAP BG] Phase 3 complete`);
        }

        console.log(`[IMAP BG] All background uploads done: ${bgAttachments} total files`);
      })().catch(err => {
        console.error('[IMAP BG] Background upload failed:', err.message);
      });
    }

    console.log(`[IMAP] Done: ${stored} stored, ${errors} errors (attachments uploading in background)`);

    return { fetched: fetchedEmails.length, stored, errors, attachmentsUploaded: 0 };
  } catch (error: any) {
    console.error('[IMAP] Error:', error.message);
    throw error;
  }
}
