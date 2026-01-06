#!/usr/bin/env tsx
/**
 * Manual database backup script
 * Run this script to create a backup immediately
 * Usage: npm run backup:run
 */

// Load environment variables from .env file
import { config } from 'dotenv'
import { resolve } from 'path'

// Load .env file from project root (using process.cwd() which is more reliable)
config({ path: resolve(process.cwd(), '.env') })

import { backupDatabase } from '../lib/backup/database-backup'

async function main() {
  try {
    console.log('[Manual Backup] 🚀 Starting manual database backup...')
    await backupDatabase()
    console.log('[Manual Backup] ✅ Backup completed successfully!')
    process.exit(0)
  } catch (error: any) {
    console.error('[Manual Backup] ❌ Backup failed:', error.message)
    process.exit(1)
  }
}

main()

