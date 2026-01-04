#!/usr/bin/env tsx

/**
 * Script to delete all tickets from the database
 * Usage: npm run db:delete-tickets
 * 
 * WARNING: This will permanently delete ALL tickets and related data!
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function deleteAllTickets() {
  try {
    console.log('🗑️  Starting deletion of all tickets...')
    console.log('⚠️  WARNING: This will permanently delete ALL tickets and related data!')
    console.log('')

    // Count tickets before deletion
    const ticketCount = await prisma.ticket.count()
    console.log(`📊 Found ${ticketCount} ticket(s) to delete`)

    if (ticketCount === 0) {
      console.log('✅ No tickets to delete')
      await prisma.$disconnect()
      return
    }

    // Delete all tickets (cascade will handle related records)
    const result = await prisma.ticket.deleteMany({})

    console.log(`✅ Successfully deleted ${result.count} ticket(s)`)
    console.log('')
    console.log('📝 Related data (comments, attachments, notifications, etc.) have been automatically deleted due to cascade constraints.')
  } catch (error: any) {
    console.error('❌ Error deleting tickets:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
deleteAllTickets()

