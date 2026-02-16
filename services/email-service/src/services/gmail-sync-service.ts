import Imap from 'imap'
import { prisma } from '../config/database'
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
const activeSyncs = new Map<string, GmailSyncService>()

export class GmailSyncService {
  private config: SyncConfig
  private imap: any = null
  private isConnected: boolean = false
  private syncInterval: NodeJS.Timeout | null = null
  private authFailed: boolean = false
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

  async start(): Promise<void> {
    if (this.status.isRunning) {
      console.log(`[Gmail Sync] Already running for ${this.config.email}`)
      return
    }

    console.log(`[Gmail Sync] Starting sync for ${this.config.email}`)
    this.status.isRunning = true
    this.initializeSync()
    console.log(`[Gmail Sync] Sync initiated for ${this.config.email}`)
  }

  private async initializeSync(): Promise<void> {
    try {
      this.syncInterval = setInterval(() => {
        this.performSync().catch(err => {
          console.error('[Gmail Sync] Periodic sync error:', err)
          this.status.lastError = err.message
        })
      }, 30 * 1000)

      this.performSync().catch(err => {
        console.error('[Gmail Sync] Initial sync error:', err)
        this.status.lastError = err.message
      })

      setTimeout(() => {
        this.startIdleConnection().catch(err => {
          console.error('[Gmail Sync] IDLE connection error:', err)
          this.status.lastError = err.message
        })
      }, 1000)
    } catch (error: any) {
      console.error('[Gmail Sync] Failed to initialize:', error)
      this.status.lastError = error.message
      this.status.isRunning = false
    }
  }

  stop(): void {
    console.log(`[Gmail Sync] Stopping sync for ${this.config.email}`)
    this.status.isRunning = false

    if (this.syncInterval) {
      clearInterval(this.syncInterval)
      this.syncInterval = null
    }

    if (this.imap) {
      try { this.imap.end() } catch {}
      this.imap = null
    }

    this.isConnected = false
    this.status.idleConnected = false
    console.log(`[Gmail Sync] Sync stopped for ${this.config.email}`)
  }

  getStatus(): SyncStatus {
    return { ...this.status }
  }

  private async performSync(): Promise<void> {
    if (this.authFailed || !this.status.isRunning) return

    console.log(`[Gmail Sync] Performing sync for ${this.config.email}...`)

    try {
      const imapConfig: GmailImapConfig = {
        email: this.config.email,
        appPassword: this.config.appPassword,
        tenantId: this.config.tenantId,
        storeId: this.config.storeId,
      }

      const result = await fetchAndStoreGmailEmails(imapConfig, { mode: 'recent' })

      this.status.emailsSynced += result.stored
      this.status.lastSync = new Date()
      this.status.lastError = null

      if (result.stored > 0) {
        console.log(`[Gmail Sync] Synced ${result.stored} new emails`)
      }
    } catch (error: any) {
      console.error('[Gmail Sync] Sync error:', error)
      this.status.lastError = error.message

      const isAuthError = error.textCode === 'AUTHENTICATIONFAILED' ||
        error.message?.includes('Invalid credentials') ||
        error.message?.includes('authentication')

      if (isAuthError) {
        console.error('[Gmail Sync] Authentication failed - stopping sync.')
        this.authFailed = true
        this.stop()
        return
      }

      throw error
    }
  }

  private async syncDeletedEmails(): Promise<void> {
    try {
      const gmailMessageIds = await this.getGmailMessageIds()
      if (gmailMessageIds.size === 0) return

      const dbEmails = await prisma.email.findMany({
        where: {
          tenantId: this.config.tenantId,
          ...(this.config.storeId ? { storeId: this.config.storeId } : {}),
        },
        select: { id: true, messageId: true },
      })

      const deletedEmails = dbEmails.filter(email => !gmailMessageIds.has(email.messageId))

      if (deletedEmails.length > 0) {
        console.log(`[Gmail Sync] Found ${deletedEmails.length} deleted emails to remove`)
        await prisma.email.deleteMany({
          where: { id: { in: deletedEmails.map(e => e.id) } },
        })
        console.log(`[Gmail Sync] Removed ${deletedEmails.length} deleted emails`)
      }
    } catch (error: any) {
      console.error('[Gmail Sync] Error syncing deleted emails:', error)
    }
  }

  private getGmailMessageIds(): Promise<Set<string>> {
    return new Promise((resolve, reject) => {
      const imap = new Imap({
        user: this.config.email,
        password: this.config.appPassword,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 90000,
        authTimeout: 60000,
      })

      const messageIds = new Set<string>()

      imap.once('ready', () => {
        imap.openBox('INBOX', true, (err: Error) => {
          if (err) { imap.end(); reject(err); return }

          imap.search(['ALL'], (searchErr: Error, results: number[]) => {
            if (searchErr || !results || results.length === 0) {
              imap.end(); resolve(messageIds); return
            }

            const fetch = imap.fetch(results, { bodies: 'HEADER.FIELDS (MESSAGE-ID)' })

            fetch.on('message', (msg: any) => {
              msg.on('body', (stream: any) => {
                let buffer = ''
                stream.on('data', (chunk: Buffer) => { buffer += chunk.toString('utf8') })
                stream.once('end', () => {
                  const match = buffer.match(/Message-ID:\s*(<[^>]+>)/i)
                  if (match) messageIds.add(match[1])
                })
              })
            })

            fetch.once('error', (fetchErr: Error) => { imap.end(); reject(fetchErr) })
            fetch.once('end', () => { imap.end(); resolve(messageIds) })
          })
        })
      })

      imap.once('error', reject)
      imap.connect()
    })
  }

  private async startIdleConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.imap = new Imap({
        user: this.config.email,
        password: this.config.appPassword,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 90000,
        authTimeout: 60000,
        keepalive: { idleInterval: 300000, forceNoop: true },
      })

      this.imap.once('ready', () => {
        this.imap.openBox('INBOX', false, (err: Error) => {
          if (err) { reject(err); return }

          this.isConnected = true
          this.status.idleConnected = true

          this.imap.on('mail', (numNewMsgs: number) => {
            console.log(`[Gmail Sync] New mail: ${numNewMsgs} message(s)`)
            this.performSync().catch(console.error)
          })

          this.imap.on('expunge', () => {
            this.syncDeletedEmails().catch(console.error)
          })

          resolve()
        })
      })

      this.imap.once('error', (err: any) => {
        this.status.idleConnected = false
        this.status.lastError = err.message

        const isAuthError = err.textCode === 'AUTHENTICATIONFAILED' ||
          err.message?.includes('Invalid credentials') ||
          err.message?.includes('authentication')

        if (isAuthError) {
          this.authFailed = true
          this.stop()
          return
        }

        if (this.status.isRunning) {
          setTimeout(() => {
            this.startIdleConnection().catch(console.error)
          }, 30000)
        }
      })

      this.imap.once('end', () => {
        this.isConnected = false
        this.status.idleConnected = false

        if (this.authFailed) return

        if (this.status.isRunning) {
          setTimeout(() => {
            this.startIdleConnection().catch(console.error)
          }, 10000)
        }
      })

      this.imap.connect()
    })
  }
}

export async function startGmailSync(
  storeId: string,
  config: { email: string; appPassword: string; tenantId: string }
): Promise<void> {
  const key = storeId || 'default'
  stopGmailSync(storeId)

  const syncService = new GmailSyncService({ ...config, storeId })
  activeSyncs.set(key, syncService)
  await syncService.start()
}

export function stopGmailSync(storeId: string): void {
  const key = storeId || 'default'
  const existing = activeSyncs.get(key)
  if (existing) { existing.stop(); activeSyncs.delete(key) }
}

export function getGmailSyncStatus(storeId: string): SyncStatus | null {
  const key = storeId || 'default'
  const service = activeSyncs.get(key)
  return service ? service.getStatus() : null
}

export function isGmailSyncRunning(storeId: string): boolean {
  const key = storeId || 'default'
  const service = activeSyncs.get(key)
  return service ? service.getStatus().isRunning : false
}

export function getAllActiveSyncs(): { storeId: string; status: SyncStatus }[] {
  const result: { storeId: string; status: SyncStatus }[] = []
  activeSyncs.forEach((service, key) => {
    result.push({ storeId: key, status: service.getStatus() })
  })
  return result
}
