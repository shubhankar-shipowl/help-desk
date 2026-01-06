// Load environment variables from .env file
import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env file from project root (using process.cwd() which is more reliable)
config({ path: resolve(process.cwd(), '.env') })

import cron from 'node-cron'
import { backupDatabase } from './database-backup'

/**
 * Database Backup Worker
 * Runs scheduled database backups using cron jobs
 * 
 * Schedule: Daily at 2:00 AM IST (Indian Standard Time)
 * Cron format: minute hour day month dayOfWeek
 * 
 * '0 2 * * *' means: At 2:00 AM IST every day
 */

console.log('[Backup Worker] 🚀 Starting database backup worker...')

// Schedule backup at 2:00 AM IST (Indian Standard Time)
// Using IST timezone directly with node-cron
// Cron expression: minute hour day month dayOfWeek
// '0 2 * * *' means: At 2:00 AM IST every day
const schedule = '0 2 * * *'
const timezone = 'Asia/Kolkata' // IST timezone

console.log(`[Backup Worker] ⏰ Scheduled backup at 2:00 AM IST (${timezone})`)

// Create cron job
const backupJob = cron.schedule(
  schedule,
  async () => {
    console.log(`[Backup Worker] ⏰ Backup scheduled task triggered at ${new Date().toISOString()}`)
    console.log(`[Backup Worker] 📅 Current time (IST): ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`)
    
    try {
      await backupDatabase()
      console.log(`[Backup Worker] ✅ Scheduled backup completed successfully`)
    } catch (error: any) {
      console.error(`[Backup Worker] ❌ Scheduled backup failed:`, error.message)
      // Don't throw - let the worker continue running
    }
  },
  {
    scheduled: true,
    timezone: timezone,
  }
)

console.log(`[Backup Worker] ✅ Backup worker started`)
console.log(`[Backup Worker] 📋 Schedule: Daily at 2:00 AM IST`)
console.log(`[Backup Worker] ⏰ Next run: ${getNextRunTime(schedule, timezone)}`)

// Function to get next run time
function getNextRunTime(schedule: string, tz?: string): string {
  try {
    // Calculate next run time manually
    const now = new Date()
    const istNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
    const utcNow = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }))
    
    // Parse schedule (format: 'minute hour * * *')
    const [minute, hour] = schedule.split(' ').map(Number)
    
    if (tz === 'Asia/Kolkata') {
      // IST timezone
      const nextRun = new Date(istNow)
      nextRun.setHours(hour, minute, 0, 0)
      if (nextRun <= istNow) {
        nextRun.setDate(nextRun.getDate() + 1)
      }
      return nextRun.toISOString()
    } else {
      // UTC timezone
      const nextRun = new Date(utcNow)
      nextRun.setUTCHours(hour, minute, 0, 0)
      if (nextRun <= utcNow) {
        nextRun.setUTCDate(nextRun.getUTCDate() + 1)
      }
      return nextRun.toISOString()
    }
  } catch (error) {
    return 'Daily at 2:00 AM IST'
  }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Backup Worker] 🛑 Received SIGTERM, stopping backup worker...')
  backupJob.stop()
  process.exit(0)
})

process.on('SIGINT', () => {
  console.log('[Backup Worker] 🛑 Received SIGINT, stopping backup worker...')
  backupJob.stop()
  process.exit(0)
})

// Keep the process alive
process.on('uncaughtException', (error) => {
  console.error('[Backup Worker] ❌ Uncaught exception:', error)
  // Don't exit - keep the worker running
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Backup Worker] ❌ Unhandled rejection at:', promise, 'reason:', reason)
  // Don't exit - keep the worker running
})

