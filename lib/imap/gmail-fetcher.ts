import Imap from 'imap'
import { simpleParser, ParsedMail } from 'mailparser'
import { prisma } from '@/lib/prisma'
import { uploadEmailAttachmentToMega } from '@/lib/storage/mega'
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

    // Extract attachments - filter out inline images
    const attachments: EmailAttachmentData[] = []
    if (parsed.attachments && parsed.attachments.length > 0) {
      for (const att of parsed.attachments) {
        if (att.contentDisposition === 'inline') continue
        
        attachments.push({
          filename: att.filename || `attachment_${Date.now()}`,
          mimeType: att.contentType || 'application/octet-stream',
          size: att.size || att.content.length,
          content: att.content,
        })
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
      hasAttachments: attachments.length > 0,
      attachments,
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

    // Check existing emails
    const messageIds = fetchedEmails.map(e => e.messageId)
    const existingEmails = await prisma.email.findMany({
      where: { messageId: { in: messageIds } },
      select: { messageId: true },
    })

    const existingSet = new Set(existingEmails.map(e => e.messageId))
    const newEmails = fetchedEmails.filter(email => !existingSet.has(email.messageId))
    
    console.log(`[IMAP] ${existingSet.size} already exist, ${newEmails.length} new`)

    if (newEmails.length === 0) {
      return { fetched: fetchedEmails.length, stored: 0, errors: 0, attachmentsUploaded: 0 }
    }

    const emailsWithAttachments = newEmails.filter(e => e.attachments.length > 0)
    const emailsWithoutAttachments = newEmails.filter(e => e.attachments.length === 0)

    const MAX_CONTENT_SIZE = 60 * 1024
    let stored = 0
    let errors = 0
    let attachmentsUploaded = 0

    // Batch insert emails WITHOUT attachments
    if (emailsWithoutAttachments.length > 0) {
      const emailsToInsert = emailsWithoutAttachments.map(email => ({
        id: randomUUID(),
        tenantId: config.tenantId,
        storeId: config.storeId || null,
        messageId: email.messageId,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        toEmail: email.toEmail,
        subject: email.subject,
        textContent: truncateContent(email.textContent, MAX_CONTENT_SIZE),
        htmlContent: truncateContent(email.htmlContent, MAX_CONTENT_SIZE),
        headers: email.headers,
        read: false,
        processed: false,
        hasAttachments: false,
        createdAt: email.date,
        updatedAt: email.date,
      }))

      const DB_BATCH_SIZE = 25
      for (let i = 0; i < emailsToInsert.length; i += DB_BATCH_SIZE) {
        const batch = emailsToInsert.slice(i, i + DB_BATCH_SIZE)
        try {
          const result = await prisma.email.createMany({
            data: batch,
            skipDuplicates: true,
          })
          stored += result.count
        } catch (error: any) {
          for (const emailData of batch) {
            try {
              await prisma.email.create({ data: emailData })
              stored++
            } catch (individualError: any) {
              if (individualError.code !== 'P2002') errors++
            }
          }
        }
      }
      console.log(`[IMAP] Stored ${stored} emails without attachments`)
    }

    // Process emails WITH attachments
    if (emailsWithAttachments.length > 0) {
      console.log(`[IMAP] Processing ${emailsWithAttachments.length} emails with attachments...`)
      
      for (const email of emailsWithAttachments) {
        try {
          const emailId = randomUUID()
          
          const upsertedEmail = await prisma.email.upsert({
            where: { messageId: email.messageId },
            update: { updatedAt: new Date() },
            create: {
              id: emailId,
              tenantId: config.tenantId,
              storeId: config.storeId || null,
              messageId: email.messageId,
              fromEmail: email.fromEmail,
              fromName: email.fromName,
              toEmail: email.toEmail,
              subject: email.subject,
              textContent: truncateContent(email.textContent, MAX_CONTENT_SIZE),
              htmlContent: truncateContent(email.htmlContent, MAX_CONTENT_SIZE),
              headers: email.headers,
              read: false,
              processed: false,
              hasAttachments: true,
              createdAt: email.date,
              updatedAt: email.date,
            },
          })
          
          stored++
          
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

    console.log(`[IMAP] ✅ Done: ${stored} stored, ${attachmentsUploaded} attachments, ${errors} errors`)

    return { fetched: fetchedEmails.length, stored, errors, attachmentsUploaded }
  } catch (error: any) {
    console.error('[IMAP] Error:', error.message)
    throw error
  }
}
