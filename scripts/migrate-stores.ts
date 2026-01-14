const { PrismaClient } = require('@prisma/client')

const prisma = new PrismaClient()

async function migrateToMultiStore() {
  console.log('Starting multi-store migration...')

  try {
    // Get all tenants
    const tenants = await prisma.tenant.findMany({
      select: { id: true, name: true },
    })

    console.log(`Found ${tenants.length} tenant(s)`)

    for (const tenant of tenants) {
      console.log(`\nProcessing tenant: ${tenant.name} (${tenant.id})`)

      // Find any existing store for this tenant (user should create their own)
      let defaultStore = await prisma.store.findFirst({
        where: {
          tenantId: tenant.id,
        },
      })

      // Only migrate if a store exists, otherwise skip migration
      if (!defaultStore) {
        console.log(`  ⚠ No store found for tenant. Please create a store first.`)
        console.log(`  ⏭ Skipping migration for tenant: ${tenant.name}`)
        continue
      }

      console.log(`  ✓ Using existing store: ${defaultStore.name} (${defaultStore.id})`)

      // Migrate users (agents) to existing store
      const usersUpdated = await prisma.user.updateMany({
        where: {
          tenantId: tenant.id,
          storeId: null,
          role: { in: ['ADMIN', 'AGENT'] },
        },
        data: {
          storeId: defaultStore.id,
        },
      })
      console.log(`  ✓ Updated ${usersUpdated.count} user(s)`)

      // Migrate tickets to default store
      const ticketsUpdated = await prisma.ticket.updateMany({
        where: {
          tenantId: tenant.id,
          storeId: null,
        },
        data: {
          storeId: defaultStore.id,
        },
      })
      console.log(`  ✓ Updated ${ticketsUpdated.count} ticket(s)`)

      // Migrate categories to default store
      const categoriesUpdated = await prisma.category.updateMany({
        where: {
          tenantId: tenant.id,
          storeId: null,
        },
        data: {
          storeId: defaultStore.id,
        },
      })
      console.log(`  ✓ Updated ${categoriesUpdated.count} category(ies)`)

      // Migrate teams to default store
      const teamsUpdated = await prisma.team.updateMany({
        where: {
          tenantId: tenant.id,
          storeId: null,
        },
        data: {
          storeId: defaultStore.id,
        },
      })
      console.log(`  ✓ Updated ${teamsUpdated.count} team(s)`)

      // Migrate tags to default store
      const tagsUpdated = await prisma.tag.updateMany({
        where: {
          tenantId: tenant.id,
          storeId: null,
        },
        data: {
          storeId: defaultStore.id,
        },
      })
      console.log(`  ✓ Updated ${tagsUpdated.count} tag(s)`)

      // Migrate templates to default store
      const templatesUpdated = await prisma.template.updateMany({
        where: {
          tenantId: tenant.id,
          storeId: null,
        },
        data: {
          storeId: defaultStore.id,
        },
      })
      console.log(`  ✓ Updated ${templatesUpdated.count} template(s)`)

      // Migrate auto-assignment rules to default store
      const rulesUpdated = await prisma.autoAssignmentRule.updateMany({
        where: {
          tenantId: tenant.id,
          storeId: null,
        },
        data: {
          storeId: defaultStore.id,
        },
      })
      console.log(`  ✓ Updated ${rulesUpdated.count} auto-assignment rule(s)`)

      // Migrate system settings to default store
      const settingsUpdated = await prisma.systemSettings.updateMany({
        where: {
          tenantId: tenant.id,
          storeId: null,
        },
        data: {
          storeId: defaultStore.id,
        },
      })
      console.log(`  ✓ Updated ${settingsUpdated.count} system setting(s)`)

      console.log(`✓ Completed migration for tenant: ${tenant.name}`)
    }

    console.log('\n✅ Multi-store migration completed successfully!')
  } catch (error) {
    console.error('❌ Migration failed:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run the migration
migrateToMultiStore()
  .then(() => {
    console.log('\nMigration script finished.')
    process.exit(0)
  })
  .catch((error) => {
    console.error('\nMigration script failed:', error)
    process.exit(1)
  })
