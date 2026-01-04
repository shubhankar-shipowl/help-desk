import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/**
 * Migration script to add multi-tenant support to existing data
 * 
 * This script:
 * 1. Creates a default tenant
 * 2. Assigns all existing data to the default tenant
 * 
 * IMPORTANT: Run this AFTER pushing the schema to database:
 *   1. npx prisma generate
 *   2. npx prisma db push
 *   3. npx tsx scripts/migrate-to-multi-tenant.ts
 */
async function migrateToMultiTenant() {
  console.log('🚀 Starting multi-tenant migration...')
  console.log('')
  console.log('⚠️  IMPORTANT: Make sure you have run "npx prisma db push" first!')
  console.log('')

  try {
    // Check if Tenant table exists by trying to count
    try {
      await prisma.tenant.count()
    } catch (error: any) {
      if (error.code === 'P2021' || error.message?.includes('does not exist')) {
        console.error('❌ ERROR: Tenant table does not exist in the database!')
        console.error('')
        console.error('Please run the following commands first:')
        console.error('  1. npx prisma generate')
        console.error('  2. npx prisma db push')
        console.error('  3. Then run this script again')
        console.error('')
        process.exit(1)
      }
      throw error
    }

    // Step 1: Create default tenant
    console.log('📦 Creating default tenant...')
    const defaultTenant = await prisma.tenant.upsert({
      where: { slug: 'default' },
      update: {},
      create: {
        name: 'Default Company',
        slug: 'default',
        isActive: true,
        settings: {},
      },
    })
    console.log(`✅ Created default tenant: ${defaultTenant.id}`)

    // Step 2: Update all users with tenantId
    // Use raw SQL to handle NULL values since tenantId is required in schema
    console.log('👥 Updating users...')
    const usersResult = await prisma.$executeRaw`
      UPDATE User 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const usersCount = await prisma.user.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${usersCount} users`)

    // Step 3: Update all tickets with tenantId
    console.log('🎫 Updating tickets...')
    await prisma.$executeRaw`
      UPDATE Ticket 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const ticketsCount = await prisma.ticket.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${ticketsCount} tickets`)

    // Step 4: Update all categories with tenantId
    console.log('📁 Updating categories...')
    await prisma.$executeRaw`
      UPDATE Category 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const categoriesCount = await prisma.category.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${categoriesCount} categories`)

    // Step 5: Update all teams with tenantId
    console.log('👔 Updating teams...')
    await prisma.$executeRaw`
      UPDATE Team 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const teamsCount = await prisma.team.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${teamsCount} teams`)

    // Step 6: Update all tags with tenantId
    console.log('🏷️  Updating tags...')
    await prisma.$executeRaw`
      UPDATE Tag 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const tagsCount = await prisma.tag.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${tagsCount} tags`)

    // Step 7: Update all templates with tenantId
    console.log('📝 Updating templates...')
    await prisma.$executeRaw`
      UPDATE Template 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const templatesCount = await prisma.template.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${templatesCount} templates`)

    // Step 8: Update all auto assignment rules with tenantId
    console.log('⚙️  Updating auto assignment rules...')
    await prisma.$executeRaw`
      UPDATE AutoAssignmentRule 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const rulesCount = await prisma.autoAssignmentRule.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${rulesCount} auto assignment rules`)

    // Step 9: Update all Facebook integrations with tenantId
    console.log('📘 Updating Facebook integrations...')
    await prisma.$executeRaw`
      UPDATE FacebookIntegration 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const fbIntegrationsCount = await prisma.facebookIntegration.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${fbIntegrationsCount} Facebook integrations`)

    // Step 10: Update all system settings with tenantId
    console.log('⚙️  Updating system settings...')
    await prisma.$executeRaw`
      UPDATE SystemSettings 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const settingsCount = await prisma.systemSettings.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${settingsCount} system settings`)

    // Step 11: Update all order tracking data with tenantId
    console.log('📦 Updating order tracking data...')
    await prisma.$executeRaw`
      UPDATE OrderTrackingData 
      SET tenantId = ${defaultTenant.id} 
      WHERE tenantId IS NULL OR tenantId = ''
    `
    const orderDataCount = await prisma.orderTrackingData.count({
      where: { tenantId: defaultTenant.id },
    })
    console.log(`✅ Updated ${orderDataCount} order tracking records`)

    console.log('')
    console.log('✅ Multi-tenant migration completed successfully!')
    console.log('')
    console.log('📋 Summary:')
    console.log(`   - Default tenant created: ${defaultTenant.name} (${defaultTenant.slug})`)
    console.log(`   - Users: ${usersCount}`)
    console.log(`   - Tickets: ${ticketsCount}`)
    console.log(`   - Categories: ${categoriesCount}`)
    console.log(`   - Teams: ${teamsCount}`)
    console.log(`   - Tags: ${tagsCount}`)
    console.log(`   - Templates: ${templatesCount}`)
    console.log(`   - Auto Assignment Rules: ${rulesCount}`)
    console.log(`   - Facebook Integrations: ${fbIntegrationsCount}`)
    console.log(`   - System Settings: ${settingsCount}`)
    console.log(`   - Order Tracking Data: ${orderDataCount}`)
    console.log('')
    console.log('⚠️  Next steps:')
    console.log('   1. Run: npx prisma generate')
    console.log('   2. Run: npx prisma db push (or create migration)')
    console.log('   3. Update all API routes to filter by tenantId')
    console.log('   4. Test the application thoroughly')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run migration
migrateToMultiTenant()
  .then(() => {
    console.log('Migration script completed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Migration script failed:', error)
    process.exit(1)
  })

