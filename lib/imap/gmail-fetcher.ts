import Imap from 'imap'
import { simpleParser, ParsedMail } from 'mailparser'
import { prisma } from '@/lib/prisma'

export interface GmailImapConfig {
  email: string
  appPassword: string
  tenantId: string
  storeId?: string | null
}

export interface FetchOptions {
  mode: 'unread' | 'latest'
  limit?: number // For 'latest' mode, how many emails to fetch
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
}

/**
 * Fetches emails from Gmail using IMAP
 */
export async function fetchGmailEmails(
  config: GmailImapConfig,
  options: FetchOptions = { mode: 'unread' }
): Promise<FetchedEmail[]> {
  return new Promise((resolve, reject) => {
    console.log(`[IMAP] Connecting to Gmail IMAP for ${config.email}...`)
    
    const imap = new Imap({
      user: config.email,
      password: config.appPassword,
      host: 'imap.gmail.com',
      port: 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }, // Gmail uses valid certificates
      connTimeout: 20000, // 20 seconds connection timeout (reduced from 30)
      authTimeout: 8000, // 8 seconds authentication timeout (reduced from 10)
      keepalive: true, // Keep connection alive
    })

    const fetchedEmails: FetchedEmail[] = []
    let isResolved = false

    // Error handler
    const handleError = (error: Error) => {
      if (!isResolved) {
        isResolved = true
        imap.end()
        reject(error)
      }
    }

    // Connection timeout handler (slightly longer than connTimeout to allow for retries)
    const connectionTimeout = setTimeout(() => {
      if (!isResolved) {
        isResolved = true
        imap.end()
        reject(new Error('IMAP connection timeout'))
      }
    }, 25000) // 25 seconds total timeout

    imap.once('ready', () => {
      clearTimeout(connectionTimeout)
      console.log('[IMAP] Connected successfully, opening INBOX...')
      
      // Open INBOX in read-only mode
      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          console.error('[IMAP] Failed to open INBOX:', err)
          handleError(new Error(`Failed to open INBOX: ${err.message}`))
          return
        }
        
        console.log(`[IMAP] INBOX opened. Total messages: ${box.messages.total}, Unread: ${box.messages.new}`)

        // Build search criteria based on mode
        let searchCriteria: any[] = ['ALL'] // Default: all emails

        if (options.mode === 'unread') {
          searchCriteria = ['UNSEEN'] // Only unread emails
        } else if (options.mode === 'latest') {
          // For latest mode, we'll fetch all and sort by date
          searchCriteria = ['ALL']
        }

        // Search for emails
        console.log(`[IMAP] Searching for emails with criteria:`, searchCriteria)
        imap.search(searchCriteria, (err, results) => {
          if (err) {
            console.error('[IMAP] Search error:', err)
            handleError(new Error(`Failed to search emails: ${err.message}`))
            return
          }

          if (!results || results.length === 0) {
            // No emails found - return empty array
            console.log('[IMAP] No emails found matching criteria')
            if (!isResolved) {
              isResolved = true
              imap.end()
              resolve([])
            }
            return
          }
          
          console.log(`[IMAP] Found ${results.length} emails matching criteria`)

          // Sort by sequence number (oldest first) and limit if needed
          let emailIds = results.sort((a, b) => a - b) // Ascending order (oldest first)
          
          // Apply limit to prevent fetching too many emails at once
          // Default to 200 emails for both 'latest' and 'unread' modes
          // For oldest first, we take the first 200 (oldest emails)
          const maxLimit = options.limit || 200 // Default to 200 for both modes
          if (emailIds.length > maxLimit) {
            console.log(`[IMAP] Limiting to ${maxLimit} oldest emails (found ${emailIds.length} total, mode: ${options.mode})`)
            emailIds = emailIds.slice(0, maxLimit) // Take first 200 (oldest)
          }

          if (emailIds.length === 0) {
            if (!isResolved) {
              isResolved = true
              imap.end()
              resolve([])
            }
            return
          }

          // Fetch emails - fetch the full email body
          const fetch = imap.fetch(emailIds, {
            bodies: '',
            struct: true,
          })

          let processedCount = 0
          const totalEmails = emailIds.length

          console.log(`[IMAP] Fetching ${totalEmails} emails...`)

          fetch.on('message', (msg, seqno) => {
            let emailBuffer = Buffer.alloc(0)
            let hasBody = false
            let bodyStreamEnded = false

            msg.on('body', (stream, info) => {
              hasBody = true
              stream.on('data', (chunk: Buffer) => {
                emailBuffer = Buffer.concat([emailBuffer, chunk])
              })
              
              stream.once('end', () => {
                bodyStreamEnded = true
              })
            })

            msg.once('attributes', (attrs) => {
              // Attributes received, but we still need to wait for body
            })

            msg.once('end', () => {
              // Parse email using mailparser
              if (hasBody && emailBuffer.length > 0) {
                console.log(`[IMAP] Parsing email ${seqno}, buffer size: ${emailBuffer.length} bytes`)
                simpleParser(emailBuffer)
                  .then((parsed: ParsedMail) => {
                    // Handle 'from' field - can be AddressObject or AddressObject[]
                    let fromEmail = ''
                    let fromName: string | null = null
                    if (parsed.from) {
                      if (Array.isArray(parsed.from)) {
                        fromEmail = parsed.from[0]?.address || ''
                        fromName = parsed.from[0]?.name || null
                      } else {
                        fromEmail = parsed.from.value?.[0]?.address || ''
                        fromName = parsed.from.value?.[0]?.name || null
                      }
                    }

                    // Handle 'to' field - can be AddressObject or AddressObject[]
                    let toEmail = ''
                    if (parsed.to) {
                      if (Array.isArray(parsed.to)) {
                        toEmail = parsed.to[0]?.address || ''
                      } else if (typeof parsed.to === 'object' && 'value' in parsed.to) {
                        toEmail = parsed.to.value?.[0]?.address || parsed.to.text || ''
                      } else if (typeof parsed.to === 'object' && 'text' in parsed.to) {
                        toEmail = parsed.to.text || ''
                      }
                    }

                    const fetchedEmail: FetchedEmail = {
                      messageId: parsed.messageId || `<${Date.now()}-${Math.random().toString(36).substring(7)}@gmail>`,
                      fromEmail,
                      fromName,
                      toEmail,
                      subject: parsed.subject || '(No Subject)',
                      date: parsed.date || new Date(),
                      textContent: parsed.text || null,
                      htmlContent: parsed.html || null,
                      headers: parsed.headers as any,
                    }

                    console.log(`[IMAP] Successfully parsed email ${seqno}: ${fetchedEmail.subject}`)
                    fetchedEmails.push(fetchedEmail)
                    processedCount++

                    // Check if all emails are processed
                    if (processedCount === totalEmails) {
                      if (!isResolved) {
                        isResolved = true
                        imap.end()
                        resolve(fetchedEmails)
                      }
                    }
                  })
                  .catch((parseError: Error) => {
                    console.error(`[IMAP] Error parsing email ${seqno}:`, parseError)
                    processedCount++

                    // Continue processing other emails even if one fails
                    if (processedCount === totalEmails) {
                      if (!isResolved) {
                        isResolved = true
                        imap.end()
                        resolve(fetchedEmails) // Return what we successfully parsed
                      }
                    }
                  })
              } else {
                // No body found, skip this email
                console.warn(`[IMAP] Email ${seqno} has no body (hasBody: ${hasBody}, bufferSize: ${emailBuffer.length}), skipping`)
                processedCount++
                if (processedCount === totalEmails) {
                  if (!isResolved) {
                    isResolved = true
                    imap.end()
                    resolve(fetchedEmails)
                  }
                }
              }
            })
          })

          fetch.once('error', (err) => {
            handleError(new Error(`Failed to fetch emails: ${err.message}`))
          })

          fetch.once('end', () => {
            // All messages fetched, but parsing might still be in progress
            // The resolve will happen when all parsing is complete
          })
        })
      })
    })

    imap.once('error', (err: Error) => {
      clearTimeout(connectionTimeout)
      console.error('[IMAP] Connection error:', err)
      handleError(new Error(`IMAP error: ${err.message}`))
    })

    imap.once('end', () => {
      clearTimeout(connectionTimeout)
      // Connection closed - if not resolved yet, resolve with what we have
      if (!isResolved) {
        isResolved = true
        resolve(fetchedEmails)
      }
    })

    // Connect to IMAP server
    imap.connect()
  })
}

/**
 * Truncates content to fit within size limit
 */
function truncateContent(content: string | null, maxSize: number, messageId: string, contentType: 'HTML' | 'TEXT'): string | null {
  if (!content) return null
  
  const contentBytes = Buffer.byteLength(content, 'utf8')
  if (contentBytes <= maxSize) {
    return content
  }
  
  console.warn(`[IMAP] Email ${messageId} has large ${contentType} content (${contentBytes} bytes), truncating to ${maxSize} bytes`)
  let truncated = content
  while (Buffer.byteLength(truncated, 'utf8') > maxSize - 100) {
    truncated = truncated.substring(0, truncated.length - 100)
  }
  return truncated + '\n\n[Content truncated due to size limit]'
}

/**
 * Fetches emails from Gmail and stores them in the database
 * Optimized with batch operations for better performance
 */
export async function fetchAndStoreGmailEmails(
  config: GmailImapConfig,
  options: FetchOptions = { mode: 'unread' }
): Promise<{ fetched: number; stored: number; errors: number }> {
  try {
    // Fetch emails from Gmail
    const fetchedEmails = await fetchGmailEmails(config, options)

    if (fetchedEmails.length === 0) {
      return { fetched: 0, stored: 0, errors: 0 }
    }

    console.log(`[IMAP] Processing ${fetchedEmails.length} emails for storage...`)

    // Batch check for existing emails (much faster than individual checks)
    const messageIds = fetchedEmails.map(e => e.messageId)
    const existingEmails = await prisma.email.findMany({
      where: {
        messageId: { in: messageIds },
      },
      select: {
        messageId: true,
      },
    })

    const existingMessageIds = new Set(existingEmails.map(e => e.messageId))
    console.log(`[IMAP] Found ${existingMessageIds.size} existing emails out of ${messageIds.length} total`)

    // Filter out existing emails and prepare new emails for batch insert
    const MAX_CONTENT_SIZE = 60 * 1024 // 60KB
    const emailsToInsert = []

    for (const email of fetchedEmails) {
      if (existingMessageIds.has(email.messageId)) {
        continue // Skip existing emails
      }

      // Truncate content if needed (done in parallel during processing)
      const htmlContent = truncateContent(email.htmlContent, MAX_CONTENT_SIZE, email.messageId, 'HTML')
      const textContent = truncateContent(email.textContent, MAX_CONTENT_SIZE, email.messageId, 'TEXT')

      emailsToInsert.push({
        tenantId: config.tenantId,
        storeId: config.storeId || null,
        messageId: email.messageId,
        fromEmail: email.fromEmail,
        fromName: email.fromName,
        toEmail: email.toEmail,
        subject: email.subject,
        textContent: textContent,
        htmlContent: htmlContent,
        headers: email.headers,
        read: false,
        processed: false,
        createdAt: email.date,
      })
    }

    if (emailsToInsert.length === 0) {
      console.log(`[IMAP] No new emails to store`)
      return {
        fetched: fetchedEmails.length,
        stored: 0,
        errors: 0,
      }
    }

    console.log(`[IMAP] Inserting ${emailsToInsert.length} new emails in batch...`)

    // Batch insert emails (much faster than individual inserts)
    // Use createMany for better performance, but handle potential duplicates
    let stored = 0
    let errors = 0

    // Process in batches to avoid potential memory issues with very large email sets
    const BATCH_SIZE = 50
    for (let i = 0; i < emailsToInsert.length; i += BATCH_SIZE) {
      const batch = emailsToInsert.slice(i, i + BATCH_SIZE)
      
      try {
        // Use createMany for batch insert (faster)
        // Note: createMany doesn't support createdAt override in some Prisma versions,
        // so we'll use individual creates in a transaction for better compatibility
        await prisma.$transaction(
          batch.map(emailData =>
            prisma.email.create({
              data: emailData,
            })
          ),
          {
            timeout: 30000, // 30 second timeout per batch
          }
        )
        stored += batch.length
        console.log(`[IMAP] Successfully stored batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} emails)`)
      } catch (error: any) {
        // If batch insert fails, try individual inserts to identify problematic emails
        console.warn(`[IMAP] Batch insert failed, trying individual inserts for batch ${Math.floor(i / BATCH_SIZE) + 1}...`)
        
        for (const emailData of batch) {
          try {
            await prisma.email.create({
              data: emailData,
            })
            stored++
          } catch (individualError: any) {
            if (individualError.code === 'P2002') {
              // Unique constraint violation - email already exists (race condition)
              // This is expected and not an error
            } else if (individualError.code === 'P2000') {
              console.error(`[IMAP] Email ${emailData.messageId} content too large even after truncation`)
              errors++
            } else {
              console.error(`[IMAP] Error storing email ${emailData.messageId}:`, individualError)
              errors++
            }
          }
        }
      }
    }

    console.log(`[IMAP] Storage complete: ${stored} stored, ${errors} errors`)

    return {
      fetched: fetchedEmails.length,
      stored,
      errors,
    }
  } catch (error: any) {
    console.error('[IMAP] Error fetching and storing emails:', error)
    throw error
  }
}
