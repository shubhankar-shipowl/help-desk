import Imap from 'imap'
import { prisma } from '@/lib/prisma'
import { fetchAndStoreGmailEmails, GmailImapConfig } from './gmail-fetcher'

/**
 * Gmail Real-time Sync Service
 * Uses IMAP IDLE for push notifications and periodic sync for reliability
 */

interface SyncConfig {
  email: string
  appPassword: string
  tenantId: string
  storeId: string | null
}

interface SyncStatus {
  isRunning: boolean
  lastSync: Date | null
  lastError: string | null
  emailsSynced: number
  idleConnected: boolean
}

// Store active sync instances by storeId
const globalForSync = globalThis as unknown as {
  activeSyncs: Map<string, GmailSyncService> | undefined
}

const activeSyncs = globalForSync.activeSyncs ?? new Map<string, GmailSyncService>()

if (process.env.NODE_ENV !== 'production') {
  globalForSync.activeSyncs = activeSyncs
}

export class GmailSyncService {
  private config: SyncConfig
  private imap: any = null
  private isConnected: boolean = false
  private syncInterval: NodeJS.Timeout | null = null
  private status: SyncStatus = {
    isRunning: false,
    lastSync: null,
    lastError: null,
    emailsSynced: 0,
    idleConnected: false,
  }

  constructor(config: SyncConfig) {
    this.config = config
  }

  /**
   * Start real-time sync
   */
  async start(): Promise<void> {
    if (this.status.isRunning) {
      console.log(`[Gmail Sync] Already running for ${this.config.email}`)
      return
    }

    console.log(`[Gmail Sync] Starting sync for ${this.config.email}`)
    this.status.isRunning = true

    // Start sync processes in the background (don't await)
    // This allows the API to respond immediately
    this.initializeSync()

    console.log(`[Gmail Sync] ✅ Sync initiated for ${this.config.email}`)
  }

  /**
   * Initialize sync processes in the background
   */
  private async initializeSync(): Promise<void> {
    try {
      // Start periodic sync every 30 seconds for more responsive updates
      // Gmail IDLE may not always work reliably, so frequent polling helps
      this.syncInterval = setInterval(() => {
        this.performSync().catch(err => {
          console.error('[Gmail Sync] Periodic sync error:', err)
          this.status.lastError = err.message
        })
      }, 30 * 1000) // 30 seconds

      // Initial sync in background
      this.performSync().catch(err => {
        console.error('[Gmail Sync] Initial sync error:', err)
        this.status.lastError = err.message
      })

      // Start IMAP IDLE connection in background (with small delay)
      setTimeout(() => {
        this.startIdleConnection().catch(err => {
          console.error('[Gmail Sync] IDLE connection error:', err)
          this.status.lastError = err.message
        })
      }, 1000) // Start IDLE after 1 second

    } catch (error: any) {
      console.error('[Gmail Sync] Failed to initialize:', error)
      this.status.lastError = error.message
      this.status.isRunning = false
    }
  }

  /**
   * Stop sync
   */
  stop(): void {
    console.log(`[Gmail Sync] Stopping sync for ${this.config.email}`)
    
    this.status.isRunning = false

    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }

    if (this.imap) {
      try {
        this.imap.end()
      } catch (e) {
        // Ignore errors when closing
      }
      this.imap = null
    }

    this.isConnected = false
    this.status.idleConnected = false
    console.log(`[Gmail Sync] ✅ Sync stopped for ${this.config.email}`)
  }

  /**
   * Get current sync status
   */
  getStatus(): SyncStatus {
    return { ...this.status }
  }

  /**
   * Perform a sync - fetch new emails and sync deleted ones
   */
  private async performSync(): Promise<void> {
    console.log(`[Gmail Sync] Performing sync for ${this.config.email}...`)

    try {
      const imapConfig: GmailImapConfig = {
        email: this.config.email,
        appPassword: this.config.appPassword,
        tenantId: this.config.tenantId,
        storeId: this.config.storeId,
      }

      // Use 'recent' mode for fast sync - only checks today's emails
      const result = await fetchAndStoreGmailEmails(imapConfig, { mode: 'recent' })
      
      this.status.emailsSynced += result.stored
      this.status.lastSync = new Date()
      this.status.lastError = null

      if (result.stored > 0) {
        console.log(`[Gmail Sync] ✅ Synced ${result.stored} new emails`)
      }

      // Disabled to reduce IMAP connections - Gmail rate limits multiple concurrent connections
      // Sync deleted emails (check if emails in DB still exist in Gmail)
      // await this.syncDeletedEmails()

    } catch (error: any) {
      console.error('[Gmail Sync] Sync error:', error)
      this.status.lastError = error.message
      throw error
    }
  }

  /**
   * Sync deleted emails - remove emails from DB that no longer exist in Gmail
   */
  private async syncDeletedEmails(): Promise<void> {
    try {
      // Get message IDs from Gmail
      const gmailMessageIds = await this.getGmailMessageIds()
      
      if (gmailMessageIds.size === 0) {
        return // No emails in Gmail, skip sync
      }

      // Get emails from DB for this store
      const dbEmails = await prisma.email.findMany({
        where: {
          tenantId: this.config.tenantId,
          ...(this.config.storeId ? { storeId: this.config.storeId } : {}),
        },
        select: {
          id: true,
          messageId: true,
        },
      })

      // Find emails in DB that no longer exist in Gmail
      const deletedEmails = dbEmails.filter(email => !gmailMessageIds.has(email.messageId))

      if (deletedEmails.length > 0) {
        console.log(`[Gmail Sync] Found ${deletedEmails.length} deleted emails to remove`)

        // Delete emails from DB (cascade will delete attachments)
        await prisma.email.deleteMany({
          where: {
            id: { in: deletedEmails.map(e => e.id) },
          },
        })

        console.log(`[Gmail Sync] ✅ Removed ${deletedEmails.length} deleted emails`)
      }
    } catch (error: any) {
      console.error('[Gmail Sync] Error syncing deleted emails:', error)
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Get all message IDs from Gmail inbox
   */
  private getGmailMessageIds(): Promise<Set<string>> {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: this.config.email,
        password: this.config.appPassword,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 90000, // Increased to 90s
        authTimeout: 60000, // Increased to 60s
      })

      const messageIds = new Set<string>()

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err: Error) => {
          if (err) {
            imap.end()
            reject(err)
            return
          }

          // Search for all emails
          imap.search(['ALL'], (searchErr: Error, results: number[]) => {
            if (searchErr || !results || results.length === 0) {
              imap.end()
              resolve(messageIds)
              return
            }

            // Fetch just the headers to get message IDs
            const fetch = imap.fetch(results, {
              bodies: 'HEADER.FIELDS (MESSAGE-ID)',
            })

            fetch.on('message', (msg: any) => {
              msg.on('body', (stream: any) => {
                let buffer = ''
                stream.on('data', (chunk: Buffer) => {
                  buffer += chunk.toString('utf8')
                })
                stream.once('end', () => {
                  // Match the full message ID including angle brackets to match DB format
                  const match = buffer.match(/Message-ID:\s*(<[^>]+>)/i)
                  if (match) {
                    messageIds.add(match[1]) // Store with angle brackets like DB does
                  }
                })
              })
            })

            fetch.once('error', (fetchErr: Error) => {
              imap.end()
              reject(fetchErr)
            })

            fetch.once('end', () => {
              imap.end()
              resolve(messageIds)
            })
          })
        })
      })

      imap.once('error', reject)
      imap.connect()
    })
  }

  /**
   * Start IMAP IDLE connection for real-time notifications
   */
  private async startIdleConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap = new Imap({
        user: this.config.email,
        password: this.config.appPassword,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 90000, // Increased to 90s
        authTimeout: 60000, // Increased to 60s
        keepalive: {
          idleInterval: 300000, // 5 minutes
          forceNoop: true,
        },
        debug: (msg: string) => {
          if (!msg.includes('BODY[')) console.log(`[IMAP RAW] ${msg}`)
        },
      })

      this.imap.once('ready', () => {
        console.log('[Gmail Sync] IMAP connected, opening INBOX...')
        
        this.imap.openBox('INBOX', false, (err: Error) => {
          if (err) {
            console.error('[Gmail Sync] Failed to open INBOX:', err)
            reject(err)
            return
          }

          console.log('[Gmail Sync] INBOX opened, starting IDLE...')
          this.isConnected = true
          this.status.idleConnected = true

          // Listen for new mail
          this.imap.on('mail', (numNewMsgs: number) => {
            console.log(`[Gmail Sync] 📬 New mail notification: ${numNewMsgs} new message(s)`)
            this.performSync().catch(err => {
              console.error('[Gmail Sync] Error syncing after new mail:', err)
            })
          })

          // Listen for expunge (deleted emails)
          this.imap.on('expunge', (seqno: number) => {
            console.log(`[Gmail Sync] 🗑️ Email expunged: seqno ${seqno}`)
            // Sync deleted emails
            this.syncDeletedEmails().catch(err => {
              console.error('[Gmail Sync] Error syncing after expunge:', err)
            })
          })

          // Listen for updates (flags changed, etc.)
          this.imap.on('update', (seqno: number, info: any) => {
            console.log(`[Gmail Sync] 📝 Email updated: seqno ${seqno}`, info)
          })

          resolve()
        })
      })

      this.imap.once('error', (err: Error) => {
        console.error('[Gmail Sync] IMAP error:', err)
        this.status.idleConnected = false
        this.status.lastError = err.message
        
        // Try to reconnect after error
        if (this.status.isRunning) {
          setTimeout(() => {
            console.log('[Gmail Sync] Attempting to reconnect IDLE...')
            this.startIdleConnection().catch(reconnectErr => {
              console.error('[Gmail Sync] Reconnect failed:', reconnectErr)
            })
          }, 30000) // Wait 30 seconds before reconnecting
        }
      })

      this.imap.once('close', (hadError: boolean) => {
        console.log(`[Gmail Sync] IMAP connection closed (hadError: ${hadError})`)
      })

      this.imap.once('end', () => {
        console.log('[Gmail Sync] IMAP connection ended')
        this.isConnected = false
        this.status.idleConnected = false
        
        // Try to reconnect if sync is still running
        if (this.status.isRunning) {
          setTimeout(() => {
            console.log('[Gmail Sync] Attempting to reconnect IDLE...')
            this.startIdleConnection().catch(reconnectErr => {
              console.error('[Gmail Sync] Reconnect failed:', reconnectErr)
            })
          }, 10000) // Wait 10 seconds before reconnecting
        }
      })

      this.imap.connect()
    })
  }
}

/**
 * Start Gmail sync for a store
 */
export async function startGmailSync(
  storeId: string,
  config: {
    email: string
    appPassword: string
    tenantId: string
  }
): Promise<void> {
  const key = storeId || 'default'
  
  // Stop existing sync if any
  stopGmailSync(storeId)

  const syncService = new GmailSyncService({
    ...config,
    storeId,
  })

  activeSyncs.set(key, syncService)
  await syncService.start()
}

/**
 * Stop Gmail sync for a store
 */
export function stopGmailSync(storeId: string): void {
  const key = storeId || 'default'
  const existing = activeSyncs.get(key)
  
  if (existing) {
    existing.stop()
    activeSyncs.delete(key)
  }
}

/**
 * Get sync status for a store
 */
export function getGmailSyncStatus(storeId: string): SyncStatus | null {
  const key = storeId || 'default'
  const service = activeSyncs.get(key)
  return service ? service.getStatus() : null
}

/**
 * Check if sync is running for a store
 */
export function isGmailSyncRunning(storeId: string): boolean {
  const key = storeId || 'default'
  const service = activeSyncs.get(key)
  return service ? service.getStatus().isRunning : false
}

/**
 * Get all active syncs
 */
export function getAllActiveSyncs(): { storeId: string; status: SyncStatus }[] {
  const result: { storeId: string; status: SyncStatus }[] = []
  activeSyncs.forEach((service, key) => {
    result.push({
      storeId: key,
      status: service.getStatus(),
    })
  })
  return result
}
