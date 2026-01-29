import Imap from 'imap'
import { simpleParser, ParsedMail } from 'mailparser'
import { prisma } from '@/lib/prisma'
import { findOrCreateThreadId, extractThreadHeaders } from '@/lib/email-threading'
import { uploadEmailAttachmentToMega } from '@/lib/storage/mega'
import { processInlineImages } from '@/lib/email-inline-images'
import { randomUUID } from 'crypto'

export interface GmailImapConfig {
  email: string
  appPassword: string
  tenantId: string
  storeId?: string | null
}

export interface FetchOptions {
  mode: 'unread' | 'latest' | 'recent' // 'recent' = last 24 hours for fast sync
  limit?: number
}

export interface EmailAttachmentData {
  filename: string
  mimeType: string
  size: number
  content: Buffer
}

export interface FetchedEmail {
  messageId: string
  fromEmail: string
  fromName: string | null
  toEmail: string
  subject: string
  date: Date
  textContent: string | null
  htmlContent: string | null
  headers: Record<string, any>
  hasAttachments: boolean
  attachments: EmailAttachmentData[]
  inlineAttachments?: Array<{ cid?: string; contentType?: string; content?: Buffer; filename?: string }>
}

// Batch size - fetch this many emails per connection
const BATCH_SIZE = 100

/**
 * Create a new IMAP connection
 */
function createImapConnection(config: GmailImapConfig): Imap {
  return new Imap({
    user: config.email,
    password: config.appPassword,
    host: 'imap.gmail.com',
    port: 993,
    tls: true,
    tlsOptions: { rejectUnauthorized: false },
    connTimeout: 30000,
    authTimeout: 15000,
    keepalive: {
      interval: 5000,
      idleInterval: 60000,
      forceNoop: true,
    },
  })
}

/**
 * Connect to IMAP and get email IDs matching criteria
 */
async function getEmailIds(config: GmailImapConfig, options: FetchOptions): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection(config)
    
    const timeout = setTimeout(() => {
      try { imap.end() } catch {}
      reject(new Error('Connection timeout'))
    }, 60000)
    
    imap.once('ready', () => {
      clearTimeout(timeout)
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          imap.end()
          reject(err)
          return
        }
        
        console.log(`[IMAP] INBOX opened. Total: ${box.messages.total}`)
        
        let searchCriteria: any[]
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
        
        if (options.mode === 'recent') {
          // For real-time sync: only check last 24 hours (TODAY)
          // This is much faster than checking 90 days
          const today = new Date()
          const formattedDate = `${today.getDate()}-${months[today.getMonth()]}-${today.getFullYear()}`
          searchCriteria = [['SINCE', formattedDate]]
          console.log(`[IMAP] Quick sync: checking emails SINCE ${formattedDate} (today)`)
        } else if (options.mode === 'unread') {
          // For initial fetch: last 90 days
          const sinceDate = new Date()
          sinceDate.setDate(sinceDate.getDate() - 90)
          const formattedDate = `${sinceDate.getDate()}-${months[sinceDate.getMonth()]}-${sinceDate.getFullYear()}`
          searchCriteria = [['SINCE', formattedDate]]
          console.log(`[IMAP] Searching for emails SINCE ${formattedDate}`)
        } else {
          searchCriteria = ['ALL']
        }
        
        imap.search(searchCriteria, (err, results) => {
          imap.end()
          
          if (err) {
            reject(err)
            return
          }
          
          const emailIds = (results || []).sort((a, b) => b - a) // Newest first
          console.log(`[IMAP] Found ${emailIds.length} emails`)
          resolve(emailIds)
        })
      })
    })
    
    imap.once('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    
    imap.connect()
  })
}

/**
 * Fetch a batch of emails using a fresh connection
 */
async function fetchBatchWithNewConnection(
  config: GmailImapConfig,
  emailIds: number[],
  batchNum: number,
  totalBatches: number
): Promise<Map<number, Buffer>> {
  return new Promise((resolve, reject) => {
    const imap = createImapConnection(config)
    const emailBuffers: Map<number, Buffer> = new Map()
    
    console.log(`[IMAP] 📦 Batch ${batchNum}/${totalBatches}: Connecting to fetch ${emailIds.length} emails...`)
    
    const timeout = setTimeout(() => {
      console.log(`[IMAP] ⏱️ Batch ${batchNum} timeout, returning ${emailBuffers.size} emails`)
      try { imap.end() } catch {}
      resolve(emailBuffers)
    }, 120000) // 2 minutes per batch
    
    imap.once('ready', () => {
      imap.openBox('INBOX', true, (err) => {
        if (err) {
          clearTimeout(timeout)
          imap.end()
          reject(err)
          return
        }
        
        let messageIndex = 0
        const messagePromises: Promise<void>[] = []
        
        const fetch = imap.fetch(emailIds, { bodies: '', struct: true })
        
        fetch.on('message', (msg, seqno) => {
          const actualEmailId = emailIds[messageIndex]
          messageIndex++
          
          const messagePromise = new Promise<void>((resolveMsg) => {
            let chunks: Buffer[] = []
            
            msg.on('body', (stream) => {
              stream.on('data', (chunk: Buffer) => {
                chunks.push(chunk)
              })
              
              stream.once('end', () => {
                if (chunks.length > 0) {
                  emailBuffers.set(actualEmailId, Buffer.concat(chunks))
                }
                chunks = []
              })
            })
            
            msg.once('end', () => resolveMsg())
            msg.once('error', () => resolveMsg())
          })
          
          messagePromises.push(messagePromise)
        })
        
        fetch.once('error', (err) => {
          console.error(`[IMAP] ❌ Batch ${batchNum} fetch error: ${err.message}`)
          // Don't reject - return what we have
          clearTimeout(timeout)
          imap.end()
          resolve(emailBuffers)
        })
        
        fetch.once('end', async () => {
          await Promise.all(messagePromises)
          clearTimeout(timeout)
          console.log(`[IMAP] ✅ Batch ${batchNum}/${totalBatches}: Received ${emailBuffers.size} emails`)
          imap.end()
          resolve(emailBuffers)
        })
      })
    })
    
    imap.once('error', (err) => {
      clearTimeout(timeout)
      console.error(`[IMAP] ❌ Batch ${batchNum} connection error: ${err.message}`)
      // Return what we have instead of rejecting
      resolve(emailBuffers)
    })
    
    imap.once('end', () => {
      clearTimeout(timeout)
    })
    
    imap.connect()
  })
}

/**
 * Main function to fetch Gmail emails with reconnection per batch
 */
export async function fetchGmailEmails(
  config: GmailImapConfig,
  options: FetchOptions = { mode: 'unread' }
): Promise<FetchedEmail[]> {
  console.log(`[IMAP] Connecting to Gmail for ${config.email}...`)
  
  // Step 1: Get all email IDs
  let emailIds: number[]
  try {
    emailIds = await getEmailIds(config, options)
  } catch (error: any) {
    console.error(`[IMAP] Failed to get email IDs: ${error.message}`)
    throw error
  }
  
  if (emailIds.length === 0) {
    console.log('[IMAP] No emails found')
    return []
  }
  
  // Apply limit
  const MAX_EMAILS = 2000
  if (options.mode === 'latest' && options.limit) {
    emailIds = emailIds.slice(0, Math.min(options.limit, MAX_EMAILS))
  } else if (emailIds.length > MAX_EMAILS) {
    console.log(`[IMAP] ⚠️ Limiting to ${MAX_EMAILS} emails`)
    emailIds = emailIds.slice(0, MAX_EMAILS)
  }
  
  // Step 2: Split into batches
  const batches: number[][] = []
  for (let i = 0; i < emailIds.length; i += BATCH_SIZE) {
    batches.push(emailIds.slice(i, i + BATCH_SIZE))
  }
  
  console.log(`[IMAP] Will fetch ${emailIds.length} emails in ${batches.length} batches of ${BATCH_SIZE}`)
  
  // Step 3: Fetch each batch with a fresh connection and retry logic
  const allEmailBuffers: Map<number, Buffer> = new Map()
  
  // Retry function with exponential backoff
  async function retryBatch(batchIndex: number, maxRetries: number = 3): Promise<Map<number, Buffer>> {
    let lastError: Error | null = null
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const batchBuffers = await fetchBatchWithNewConnection(
          config,
          batches[batchIndex],
          batchIndex + 1,
          batches.length
        )
        
        if (batchBuffers.size > 0) {
          return batchBuffers
        }
        
        // If we got 0 emails, wait before retry
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s
          console.log(`[IMAP] Batch ${batchIndex + 1} returned 0 emails, retrying in ${delay/1000}s (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise(r => setTimeout(r, delay))
        }
      } catch (error: any) {
        lastError = error
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000
          console.log(`[IMAP] Batch ${batchIndex + 1} failed: ${error.message}, retrying in ${delay/1000}s (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }
    
    console.error(`[IMAP] Batch ${batchIndex + 1} failed after ${maxRetries} attempts`)
    return new Map()
  }
  
  for (let i = 0; i < batches.length; i++) {
    const batchBuffers = await retryBatch(i)
    
    batchBuffers.forEach((buffer, emailId) => {
      allEmailBuffers.set(emailId, buffer)
    })
    
    console.log(`[IMAP] Progress: ${allEmailBuffers.size}/${emailIds.length} emails fetched (${Math.round(allEmailBuffers.size/emailIds.length*100)}%)`)
    
    // Longer delay between batches to avoid Gmail rate limiting
    if (i < batches.length - 1) {
      const delay = 2000 // 2 seconds between batches
      console.log(`[IMAP] Waiting ${delay/1000}s before next batch...`)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  
  console.log(`[IMAP] All batches complete. Total: ${allEmailBuffers.size}/${emailIds.length} emails`)
  
  if (allEmailBuffers.size === 0) {
    console.log('[IMAP] ⚠️ No email bodies received')
    return []
  }
  
  // Step 4: Parse emails
  console.log(`[IMAP] Parsing ${allEmailBuffers.size} emails...`)
  const allParsedEmails: FetchedEmail[] = []
  const entries = Array.from(allEmailBuffers.entries())
  
  const PARSE_BATCH_SIZE = 20
  for (let i = 0; i < entries.length; i += PARSE_BATCH_SIZE) {
    const parseBatch = entries.slice(i, i + PARSE_BATCH_SIZE)
    const parsePromises = parseBatch.map(async ([seqno, buffer]) => {
      try {
        const parsed = await simpleParser(buffer)
        return parseEmailData(parsed, seqno)
      } catch (err) {
        return null
      }
    })
    
    const results = await Promise.all(parsePromises)
    const validEmails = results.filter((e): e is FetchedEmail => e !== null)
    allParsedEmails.push(...validEmails)
    
    if ((i + PARSE_BATCH_SIZE) % 100 === 0 || i + PARSE_BATCH_SIZE >= entries.length) {
      console.log(`[IMAP] ⏳ Parsed ${Math.min(i + PARSE_BATCH_SIZE, entries.length)}/${entries.length} emails`)
    }
  }
  
  console.log(`[IMAP] ✅ Successfully parsed ${allParsedEmails.length} emails`)
  return allParsedEmails
}

/**
 * Parse email data from mailparser result
 */
function parseEmailData(parsed: ParsedMail, seqno: number): FetchedEmail | null {
  try {
    let fromEmail = ''
    let fromName: string | null = null
    
    if (parsed.from) {
      if (Array.isArray(parsed.from)) {
        fromEmail = parsed.from[0]?.value?.[0]?.address || ''
        fromName = parsed.from[0]?.value?.[0]?.name || null
      } else {
        fromEmail = parsed.from.value?.[0]?.address || ''
        fromName = parsed.from.value?.[0]?.name || null
      }
    }

    let toEmail = ''
    if (parsed.to) {
      if (Array.isArray(parsed.to)) {
        toEmail = parsed.to[0]?.value?.[0]?.address || ''
      } else {
        toEmail = parsed.to.value?.[0]?.address || parsed.to.text || ''
      }
    }

    // Extract attachments - filter out inline images (they'll be processed separately)
    const attachments: EmailAttachmentData[] = []
    const inlineAttachments: Array<{ cid?: string; contentType?: string; content?: Buffer; filename?: string }> = []
    
    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments) {
        if (att.contentDisposition === 'inline') {
          // Store inline attachments for processing with HTML
          inlineAttachments.push({
            cid: att.cid,
            contentType: att.contentType,
            content: att.content,
            filename: att.filename,
          })
        } else {
          attachments.push({
            filename: att.filename || `attachment_${Date.now()}`,
            mimeType: att.contentType || 'application/octet-stream',
            size: att.size || att.content.length,
            content: att.content,
          })
        }
      }
    }

    return {
      messageId: parsed.messageId || `<${Date.now()}-${seqno}@gmail>`,
      fromEmail,
      fromName,
      toEmail,
      subject: parsed.subject || '(No Subject)',
      date: parsed.date || new Date(),
      textContent: parsed.text || null,
      htmlContent: parsed.html || null,
      headers: parsed.headers as any,
      hasAttachments: attachments.length > 0 || inlineAttachments.length > 0,
      attachments,
      inlineAttachments, // Include inline attachments for processing
    }
  } catch {
    return null
  }
}

/**
 * Truncates content to fit within size limit
 */
function truncateContent(content: string | null, maxSize: number): string | null {
  if (!content) return null
  
  const contentBytes = Buffer.byteLength(content, 'utf8')
  if (contentBytes <= maxSize) return content
  
  let truncated = content.substring(0, Math.floor(maxSize * 0.9))
  return truncated + '\n\n[Content truncated]'
}

/**
 * Upload attachments to MEGA and return attachment records
 */
async function uploadAttachmentsToMega(
  attachments: EmailAttachmentData[],
  emailId: string
): Promise<{ filename: string; mimeType: string; size: number; fileUrl: string; fileHandle: string }[]> {
  const uploadedAttachments: { filename: string; mimeType: string; size: number; fileUrl: string; fileHandle: string }[] = []
  
  for (const attachment of attachments) {
    try {
      console.log(`[MEGA] Uploading: ${attachment.filename} (${(attachment.size / 1024).toFixed(2)} KB)`)
      
      const result = await uploadEmailAttachmentToMega(
        attachment.content,
        attachment.filename,
        attachment.mimeType,
        emailId
      )
      
      uploadedAttachments.push({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        fileUrl: result.fileUrl,
        fileHandle: result.fileHandle,
      })
      
      console.log(`[MEGA] ✅ Uploaded: ${attachment.filename}`)
    } catch (error: any) {
      console.error(`[MEGA] ❌ Failed: ${attachment.filename}`, error.message)
    }
  }
  
  return uploadedAttachments
}

/**
 * Fetches and stores Gmail emails with batch operations
 */
export async function fetchAndStoreGmailEmails(
  config: GmailImapConfig,
  options: FetchOptions = { mode: 'unread' }
): Promise<{ fetched: number; stored: number; errors: number; attachmentsUploaded: number }> {
  try {
    const fetchedEmails = await fetchGmailEmails(config, options)

    if (fetchedEmails.length === 0) {
      return { fetched: 0, stored: 0, errors: 0, attachmentsUploaded: 0 }
    }

    console.log(`[IMAP] Processing ${fetchedEmails.length} emails for storage...`)

    // Check existing emails - also check if they need reprocessing (have data URIs)
    const messageIds = fetchedEmails.map(e => e.messageId)
    const existingEmails = await prisma.email.findMany({
      where: { messageId: { in: messageIds } },
      select: { 
        messageId: true,
        id: true,
        htmlContent: true,
        EmailAttachment: {
          select: {
            mimeType: true,
            fileUrl: true,
          },
        },
      },
    })

    const existingSet = new Set(existingEmails.map(e => e.messageId))
    const newEmails = fetchedEmails.filter(email => !existingSet.has(email.messageId))
    
    // Check existing emails for unprocessed data URIs
    const emailsNeedingReprocessing: Array<{ email: typeof fetchedEmails[0]; dbEmail: typeof existingEmails[0] }> = []
    for (const fetchedEmail of fetchedEmails) {
      const dbEmail = existingEmails.find(e => e.messageId === fetchedEmail.messageId)
      if (dbEmail) {
        const hasDataUris = dbEmail.htmlContent?.includes('data:image/') || dbEmail.htmlContent?.includes('data:video/')
        const hasMegaUrls = dbEmail.htmlContent?.includes('/api/storage/mega/')
        // If email has data URIs but no Mega URLs, it needs reprocessing
        if (hasDataUris && !hasMegaUrls) {
          emailsNeedingReprocessing.push({ email: fetchedEmail, dbEmail })
        }
      }
    }
    
    console.log(`[IMAP] ${existingSet.size} already exist, ${newEmails.length} new`)
    if (emailsNeedingReprocessing.length > 0) {
      console.log(`[IMAP] 🔄 ${emailsNeedingReprocessing.length} existing email(s) need reprocessing (have data URIs but no Mega URLs)`)
    }

    if (newEmails.length === 0 && emailsNeedingReprocessing.length === 0) {
      return { fetched: fetchedEmails.length, stored: 0, errors: 0, attachmentsUploaded: 0 }
    }

    const emailsWithAttachments = newEmails.filter(e => e.attachments.length > 0)
    const emailsWithoutAttachments = newEmails.filter(e => e.attachments.length === 0)

    const MAX_CONTENT_SIZE = 60 * 1024
    let stored = 0
    let errors = 0
    let attachmentsUploaded = 0

    // Process emails WITHOUT regular attachments (but may have inline images)
    if (emailsWithoutAttachments.length > 0) {
      // Process each email individually to handle inline images
      for (const email of emailsWithoutAttachments) {
        try {
          const emailId = randomUUID()
          
          // Compute threadId
          const threadId = await findOrCreateThreadId(
            {
              messageId: email.messageId,
              subject: email.subject,
              fromEmail: email.fromEmail,
              toEmail: email.toEmail,
              headers: email.headers,
            },
            config.tenantId,
            config.storeId || null
          )

          // Process inline images from HTML content BEFORE truncating
          // IMPORTANT: Process images first, then truncate, to avoid cutting off data URIs
          let processedHtmlContent = email.htmlContent
          let hasInlineImages = false
          
          // Check if HTML has images (data URIs or CID references)
          const hasDataUris = email.htmlContent?.includes('data:image/') || email.htmlContent?.includes('data:video/')
          const hasCidRefs = email.htmlContent?.includes('cid:')
          
          if (email.htmlContent && (hasDataUris || (hasCidRefs && email.inlineAttachments && email.inlineAttachments.length > 0))) {
            try {
              console.log(`[IMAP] 🖼️  Processing inline images for email ${email.messageId.substring(0, 20)}...`)
              console.log(`[IMAP]    - Data URIs: ${hasDataUris}, CID refs: ${hasCidRefs}, inline attachments: ${email.inlineAttachments?.length || 0}`)
              console.log(`[IMAP]    - HTML length: ${email.htmlContent.length} chars`)
              
              const { processedHtml, uploadedImages } = await processInlineImages(
                email.htmlContent,
                emailId,
                email.inlineAttachments // Pass inline attachments for CID resolution
              )
              
              if (processedHtml && processedHtml !== email.htmlContent) {
                processedHtmlContent = processedHtml // Keep full processed HTML
                console.log(`[IMAP] ✅ Processed ${uploadedImages.length} inline image(s) for email ${email.messageId.substring(0, 20)}`)
                console.log(`[IMAP]    - Processed HTML length: ${processedHtml.length} chars`)
              } else {
                console.log(`[IMAP] ⚠️  No changes after processing inline images`)
              }
              
              // Store inline images as EmailAttachment records
              for (const image of uploadedImages) {
                try {
                  await prisma.emailAttachment.create({
                    data: {
                      id: randomUUID(),
                      emailId: emailId,
                      filename: image.filename,
                      mimeType: image.mimeType,
                      size: image.size,
                      fileUrl: image.fileUrl,
                      fileHandle: image.fileHandle,
                    },
                  })
                  hasInlineImages = true
                  attachmentsUploaded++
                } catch (error) {
                  console.error('[IMAP] Error storing inline image:', error)
                }
              }
            } catch (error) {
              console.error('[IMAP] Error processing inline images:', error)
              // Continue with original HTML if processing fails
            }
          } else if (hasCidRefs && (!email.inlineAttachments || email.inlineAttachments.length === 0)) {
            console.warn(`[IMAP] ⚠️ Email ${email.messageId.substring(0, 20)} has CID references but no inline attachments parsed`)
          }

          // Truncate HTML AFTER processing images (to preserve Mega URLs)
          const finalHtmlContent = truncateContent(processedHtmlContent, MAX_CONTENT_SIZE)

          // Create email record
          await prisma.email.create({
            data: {
              id: emailId,
              tenantId: config.tenantId,
              storeId: config.storeId || null,
              messageId: email.messageId,
              threadId,
              fromEmail: email.fromEmail,
              fromName: email.fromName,
              toEmail: email.toEmail,
              subject: email.subject,
              textContent: truncateContent(email.textContent, MAX_CONTENT_SIZE),
              htmlContent: finalHtmlContent, // Use truncated HTML after processing
              headers: email.headers,
              read: false,
              processed: false,
              hasAttachments: hasInlineImages,
              createdAt: email.date,
              updatedAt: email.date,
            },
          })
          
          stored++
        } catch (error: any) {
          if (error.code !== 'P2002') errors++
        }
      }
      
      console.log(`[IMAP] Stored ${stored} emails (some may have inline images)`)
    }

    // Process emails WITH attachments
    if (emailsWithAttachments.length > 0) {
      console.log(`[IMAP] Processing ${emailsWithAttachments.length} emails with attachments...`)
      
      for (const email of emailsWithAttachments) {
        try {
          const emailId = randomUUID()
          
          // Compute threadId before inserting
          const threadId = await findOrCreateThreadId(
            {
              messageId: email.messageId,
              subject: email.subject,
              fromEmail: email.fromEmail,
              toEmail: email.toEmail,
              headers: email.headers,
            },
            config.tenantId,
            config.storeId || null
          )
          
          // Process inline images from HTML content BEFORE truncating
          // IMPORTANT: Process images first, then truncate, to avoid cutting off data URIs
          let processedHtmlContent = email.htmlContent
          let inlineImagesUploaded = 0
          
          // Check if HTML has images (data URIs or CID references)
          const hasDataUris = email.htmlContent?.includes('data:image/') || email.htmlContent?.includes('data:video/')
          const hasCidRefs = email.htmlContent?.includes('cid:')
          
          if (email.htmlContent && (hasDataUris || (hasCidRefs && email.inlineAttachments && email.inlineAttachments.length > 0))) {
            try {
              console.log(`[IMAP] 🖼️  Processing inline images for email ${email.messageId.substring(0, 20)}...`)
              console.log(`[IMAP]    - Data URIs: ${hasDataUris}, CID refs: ${hasCidRefs}, inline attachments: ${email.inlineAttachments?.length || 0}`)
              console.log(`[IMAP]    - HTML length: ${email.htmlContent.length} chars`)
              
              const { processedHtml, uploadedImages } = await processInlineImages(
                email.htmlContent,
                emailId,
                email.inlineAttachments // Pass inline attachments for CID resolution
              )
              
              if (processedHtml && processedHtml !== email.htmlContent) {
                processedHtmlContent = processedHtml // Keep full processed HTML
                console.log(`[IMAP] ✅ Processed ${uploadedImages.length} inline image(s) for email ${email.messageId.substring(0, 20)}`)
                console.log(`[IMAP]    - Processed HTML length: ${processedHtml.length} chars`)
              } else {
                console.log(`[IMAP] ⚠️  No changes after processing inline images`)
              }
              
              // Store inline images as EmailAttachment records
              for (const image of uploadedImages) {
                try {
                  await prisma.emailAttachment.create({
                    data: {
                      id: randomUUID(),
                      emailId: emailId,
                      filename: image.filename,
                      mimeType: image.mimeType,
                      size: image.size,
                      fileUrl: image.fileUrl,
                      fileHandle: image.fileHandle,
                    },
                  })
                  inlineImagesUploaded++
                  attachmentsUploaded++
                } catch (error) {
                  console.error('[IMAP] Error storing inline image:', error)
                }
              }
            } catch (error) {
              console.error('[IMAP] Error processing inline images:', error)
              // Continue with original HTML if processing fails
            }
          } else if (hasCidRefs && (!email.inlineAttachments || email.inlineAttachments.length === 0)) {
            console.warn(`[IMAP] ⚠️ Email ${email.messageId.substring(0, 20)} has CID references but no inline attachments parsed`)
          }

          // Truncate HTML AFTER processing images (to preserve Mega URLs)
          const finalHtmlContent = truncateContent(processedHtmlContent, MAX_CONTENT_SIZE)
          
          const upsertedEmail = await prisma.email.upsert({
            where: { messageId: email.messageId },
            update: { 
              updatedAt: new Date(),
              threadId, // Update threadId if email already exists
              htmlContent: finalHtmlContent, // Update with processed and truncated HTML
            },
            create: {
              id: emailId,
              tenantId: config.tenantId,
              storeId: config.storeId || null,
              messageId: email.messageId,
              threadId,
              fromEmail: email.fromEmail,
              fromName: email.fromName,
              toEmail: email.toEmail,
              subject: email.subject,
              textContent: truncateContent(email.textContent, MAX_CONTENT_SIZE),
              htmlContent: finalHtmlContent, // Use processed and truncated HTML with Mega URLs
              headers: email.headers,
              read: false,
              processed: false,
              hasAttachments: email.attachments.length > 0 || inlineImagesUploaded > 0,
              createdAt: email.date,
              updatedAt: email.date,
            },
          })
          
          stored++
          
          // Upload regular attachments
          const uploadedAttachments = await uploadAttachmentsToMega(email.attachments, upsertedEmail.id)
          
          for (const att of uploadedAttachments) {
            try {
              await prisma.emailAttachment.create({
                data: {
                  id: randomUUID(),
                  emailId: upsertedEmail.id,
                  filename: att.filename,
                  mimeType: att.mimeType,
                  size: att.size,
                  fileUrl: att.fileUrl,
                  fileHandle: att.fileHandle,
                },
              })
              attachmentsUploaded++
            } catch {}
          }
          
          console.log(`[IMAP] ✅ Stored: ${email.subject.substring(0, 50)}...`)
        } catch (error: any) {
          if (error.code !== 'P2002') errors++
        }
      }
    }

    // Reprocess existing emails that have data URIs but no Mega URLs
    if (emailsNeedingReprocessing.length > 0) {
      console.log(`[IMAP] 🔄 Reprocessing ${emailsNeedingReprocessing.length} existing email(s) with unprocessed images...`)
      
      for (const { email: fetchedEmail, dbEmail } of emailsNeedingReprocessing) {
        try {
          console.log(`[IMAP] 🔄 Reprocessing email ${fetchedEmail.messageId.substring(0, 20)}...`)
          
          // Process inline images from the fetched email's HTML
          const hasDataUris = fetchedEmail.htmlContent?.includes('data:image/') || fetchedEmail.htmlContent?.includes('data:video/')
          const hasCidRefs = fetchedEmail.htmlContent?.includes('cid:')
          
          if (fetchedEmail.htmlContent && (hasDataUris || (hasCidRefs && fetchedEmail.inlineAttachments && fetchedEmail.inlineAttachments.length > 0))) {
            try {
              const { processedHtml, uploadedImages } = await processInlineImages(
                fetchedEmail.htmlContent,
                dbEmail.id,
                fetchedEmail.inlineAttachments
              )
              
              if (processedHtml && processedHtml !== fetchedEmail.htmlContent) {
                const finalHtmlContent = truncateContent(processedHtml, MAX_CONTENT_SIZE)
                
                // Update email with processed HTML
                await prisma.email.update({
                  where: { id: dbEmail.id },
                  data: {
                    htmlContent: finalHtmlContent,
                    hasAttachments: (dbEmail.EmailAttachment?.length || 0) + uploadedImages.length > 0,
                    updatedAt: new Date(),
                  },
                })
                
                // Store uploaded images as EmailAttachment records
                for (const image of uploadedImages) {
                  try {
                    await prisma.emailAttachment.create({
                      data: {
                        id: randomUUID(),
                        emailId: dbEmail.id,
                        filename: image.filename,
                        mimeType: image.mimeType,
                        size: image.size,
                        fileUrl: image.fileUrl,
                        fileHandle: image.fileHandle,
                      },
                    })
                    attachmentsUploaded++
                  } catch (error) {
                    console.error('[IMAP] Error storing reprocessed inline image:', error)
                  }
                }
                
                console.log(`[IMAP] ✅ Reprocessed ${uploadedImages.length} inline image(s) for email ${fetchedEmail.messageId.substring(0, 20)}`)
              }
            } catch (error) {
              console.error(`[IMAP] ❌ Error reprocessing inline images for email ${fetchedEmail.messageId.substring(0, 20)}:`, error)
            }
          }
        } catch (error: any) {
          console.error(`[IMAP] ❌ Error reprocessing email ${fetchedEmail.messageId.substring(0, 20)}:`, error.message)
          errors++
        }
      }
    }

    console.log(`[IMAP] ✅ Done: ${stored} stored, ${attachmentsUploaded} attachments, ${errors} errors`)

    return { fetched: fetchedEmails.length, stored, errors, attachmentsUploaded }
  } catch (error: any) {
    console.error('[IMAP] Error:', error.message)
    throw error
  }
}
