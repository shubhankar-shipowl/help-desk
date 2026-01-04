#!/usr/bin/env tsx

/**
 * Script to clean/delete all data from the database
 * Usage: npm run db:clean
 * 
 * WARNING: This will permanently delete ALL data from ALL tables!
 * This includes:
 * - All tickets, comments, attachments
 * - All users (except you can optionally keep admins)
 * - All categories, teams, tags
 * - All notifications, order tracking data
 * - All system settings, templates, etc.
 * 
 * The database structure (tables, indexes) will remain intact.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function cleanDatabase() {
  try {
    console.log('🧹 Starting database cleanup...')
    console.log('⚠️  WARNING: This will permanently delete ALL data from ALL tables!')
    console.log('')

    // Delete in order to respect foreign key constraints
    // Start with dependent tables first

    console.log('📊 Step 1: Deleting notification delivery logs...')
    const deliveryLogs = await prisma.notificationDeliveryLog.deleteMany({})
    console.log(`   ✅ Deleted ${deliveryLogs.count} notification delivery logs`)

    console.log('📊 Step 2: Deleting Facebook notifications...')
    const fbNotifications = await prisma.facebookNotification.deleteMany({})
    console.log(`   ✅ Deleted ${fbNotifications.count} Facebook notifications`)

    console.log('📊 Step 3: Deleting notifications...')
    const notifications = await prisma.notification.deleteMany({})
    console.log(`   ✅ Deleted ${notifications.count} notifications`)

    console.log('📊 Step 4: Deleting push subscriptions...')
    const pushSubs = await prisma.pushSubscription.deleteMany({})
    console.log(`   ✅ Deleted ${pushSubs.count} push subscriptions`)

    console.log('📊 Step 5: Deleting notification preferences...')
    const notifPrefs = await prisma.notificationPreference.deleteMany({})
    console.log(`   ✅ Deleted ${notifPrefs.count} notification preferences`)

    console.log('📊 Step 6: Deleting satisfaction ratings...')
    const ratings = await prisma.satisfactionRating.deleteMany({})
    console.log(`   ✅ Deleted ${ratings.count} satisfaction ratings`)

    console.log('📊 Step 7: Deleting ticket activities...')
    const activities = await prisma.ticketActivity.deleteMany({})
    console.log(`   ✅ Deleted ${activities.count} ticket activities`)

    console.log('📊 Step 8: Deleting audit logs...')
    const auditLogs = await prisma.auditLog.deleteMany({})
    console.log(`   ✅ Deleted ${auditLogs.count} audit logs`)

    console.log('📊 Step 9: Deleting attachments...')
    const attachments = await prisma.attachment.deleteMany({})
    console.log(`   ✅ Deleted ${attachments.count} attachments`)

    console.log('📊 Step 10: Deleting comments...')
    const comments = await prisma.comment.deleteMany({})
    console.log(`   ✅ Deleted ${comments.count} comments`)

    console.log('📊 Step 11: Deleting ticket tags...')
    const ticketTags = await prisma.ticketTag.deleteMany({})
    console.log(`   ✅ Deleted ${ticketTags.count} ticket tags`)

    console.log('📊 Step 12: Deleting call logs...')
    const callLogs = await prisma.callLog.deleteMany({})
    console.log(`   ✅ Deleted ${callLogs.count} call logs`)

    console.log('📊 Step 13: Deleting tickets...')
    const tickets = await prisma.ticket.deleteMany({})
    console.log(`   ✅ Deleted ${tickets.count} tickets`)

    console.log('📊 Step 14: Deleting order tracking data...')
    const orderData = await prisma.orderTrackingData.deleteMany({})
    console.log(`   ✅ Deleted ${orderData.count} order tracking records`)

    console.log('📊 Step 15: Deleting system settings...')
    const settings = await prisma.systemSettings.deleteMany({})
    console.log(`   ✅ Deleted ${settings.count} system settings`)

    console.log('📊 Step 16: Deleting templates...')
    const templates = await prisma.template.deleteMany({})
    console.log(`   ✅ Deleted ${templates.count} templates`)

    console.log('📊 Step 17: Deleting auto assignment rules...')
    const rules = await prisma.autoAssignmentRule.deleteMany({})
    console.log(`   ✅ Deleted ${rules.count} auto assignment rules`)

    console.log('📊 Step 18: Deleting Facebook integrations...')
    const fbIntegrations = await prisma.facebookIntegration.deleteMany({})
    console.log(`   ✅ Deleted ${fbIntegrations.count} Facebook integrations`)

    console.log('📊 Step 19: Deleting tags...')
    const tags = await prisma.tag.deleteMany({})
    console.log(`   ✅ Deleted ${tags.count} tags`)

    console.log('📊 Step 20: Deleting team members...')
    const teamMembers = await prisma.teamMember.deleteMany({})
    console.log(`   ✅ Deleted ${teamMembers.count} team members`)

    console.log('📊 Step 21: Deleting SLA rules...')
    const slaRules = await prisma.sLARule.deleteMany({})
    console.log(`   ✅ Deleted ${slaRules.count} SLA rules`)

    console.log('📊 Step 22: Deleting teams...')
    const teams = await prisma.team.deleteMany({})
    console.log(`   ✅ Deleted ${teams.count} teams`)

    console.log('📊 Step 23: Deleting categories...')
    const categories = await prisma.category.deleteMany({})
    console.log(`   ✅ Deleted ${categories.count} categories`)

    console.log('📊 Step 24: Deleting users...')
    const users = await prisma.user.deleteMany({})
    console.log(`   ✅ Deleted ${users.count} users`)

    console.log('📊 Step 25: Deleting tenants...')
    const tenants = await prisma.tenant.deleteMany({})
    console.log(`   ✅ Deleted ${tenants.count} tenants`)

    console.log('')
    console.log('✅ Database cleanup completed successfully!')
    console.log('')
    console.log('📋 Summary:')
    console.log(`   - Notification Delivery Logs: ${deliveryLogs.count}`)
    console.log(`   - Facebook Notifications: ${fbNotifications.count}`)
    console.log(`   - Notifications: ${notifications.count}`)
    console.log(`   - Push Subscriptions: ${pushSubs.count}`)
    console.log(`   - Notification Preferences: ${notifPrefs.count}`)
    console.log(`   - Satisfaction Ratings: ${ratings.count}`)
    console.log(`   - Ticket Activities: ${activities.count}`)
    console.log(`   - Audit Logs: ${auditLogs.count}`)
    console.log(`   - Attachments: ${attachments.count}`)
    console.log(`   - Comments: ${comments.count}`)
    console.log(`   - Ticket Tags: ${ticketTags.count}`)
    console.log(`   - Call Logs: ${callLogs.count}`)
    console.log(`   - Tickets: ${tickets.count}`)
    console.log(`   - Order Tracking Data: ${orderData.count}`)
    console.log(`   - System Settings: ${settings.count}`)
    console.log(`   - Templates: ${templates.count}`)
    console.log(`   - Auto Assignment Rules: ${rules.count}`)
    console.log(`   - Facebook Integrations: ${fbIntegrations.count}`)
    console.log(`   - Tags: ${tags.count}`)
    console.log(`   - Team Members: ${teamMembers.count}`)
    console.log(`   - SLA Rules: ${slaRules.count}`)
    console.log(`   - Teams: ${teams.count}`)
    console.log(`   - Categories: ${categories.count}`)
    console.log(`   - Users: ${users.count}`)
    console.log(`   - Tenants: ${tenants.count}`)
    console.log('')
    console.log('💡 Note: Database structure (tables, indexes) remains intact.')
    console.log('   You can now seed the database with: npm run db:seed')
  } catch (error: any) {
    console.error('❌ Error cleaning database:', error)
    process.exit(1)
  } finally {
    await prisma.$disconnect()
  }
}

// Run the script
cleanDatabase()

