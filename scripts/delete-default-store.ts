import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function deleteDefaultStore() {
  console.log('🗑️  Deleting default stores...')

  try {
    // Find all stores named "Main Store" (the default store)
    const defaultStores = await prisma.store.findMany({
      where: {
        name: 'Main Store',
      },
      include: {
        _count: {
          select: {
            users: true,
            tickets: true,
            categories: true,
            teams: true,
            tags: true,
            templates: true,
          },
        },
      },
    })

    if (defaultStores.length === 0) {
      console.log('✅ No default stores found to delete.')
      return
    }

    console.log(`Found ${defaultStores.length} default store(s) to delete:`)
    
    for (const store of defaultStores) {
      console.log(`\n📦 Store: ${store.name} (${store.id})`)
      console.log(`   - Users: ${store._count.users}`)
      console.log(`   - Tickets: ${store._count.tickets}`)
      console.log(`   - Categories: ${store._count.categories}`)
      console.log(`   - Teams: ${store._count.teams}`)
      console.log(`   - Tags: ${store._count.tags}`)
      console.log(`   - Templates: ${store._count.templates}`)

      // Check if store has any data
      const hasData = 
        store._count.users > 0 ||
        store._count.tickets > 0 ||
        store._count.categories > 0 ||
        store._count.teams > 0 ||
        store._count.tags > 0 ||
        store._count.templates > 0

      if (hasData) {
        console.log(`   ⚠️  Warning: This store has data associated with it.`)
        console.log(`   ⚠️  Deleting will set storeId to null for all related records.`)
      }
    }

    // Ask for confirmation (in a real script, you might want to use readline)
    console.log('\n⚠️  This will permanently delete the default store(s).')
    console.log('⚠️  Related records will have their storeId set to null.')
    console.log('\nTo proceed, run this script with --confirm flag:')
    console.log('  tsx scripts/delete-default-store.ts --confirm')

    // Check for confirmation flag
    const args = process.argv.slice(2)
    if (!args.includes('--confirm')) {
      console.log('\n❌ Deletion cancelled. Use --confirm flag to proceed.')
      return
    }

    // Delete the stores
    for (const store of defaultStores) {
      // First, set storeId to null for all related records
      console.log(`\n🔄 Removing store associations for ${store.name}...`)

      await prisma.user.updateMany({
        where: { storeId: store.id },
        data: { storeId: null },
      })

      await prisma.ticket.updateMany({
        where: { storeId: store.id },
        data: { storeId: null },
      })

      await prisma.category.updateMany({
        where: { storeId: store.id },
        data: { storeId: null },
      })

      await prisma.team.updateMany({
        where: { storeId: store.id },
        data: { storeId: null },
      })

      await prisma.tag.updateMany({
        where: { storeId: store.id },
        data: { storeId: null },
      })

      await prisma.template.updateMany({
        where: { storeId: store.id },
        data: { storeId: null },
      })

      await prisma.autoAssignmentRule.updateMany({
        where: { storeId: store.id },
        data: { storeId: null },
      })

      await prisma.systemSettings.updateMany({
        where: { storeId: store.id },
        data: { storeId: null },
      })

      // Now delete the store
      await prisma.store.delete({
        where: { id: store.id },
      })

      console.log(`   ✅ Deleted store: ${store.name}`)
    }

    console.log('\n✅ Default store(s) deleted successfully!')
    console.log('📝 You can now create your own stores through the admin panel.')
  } catch (error) {
    console.error('❌ Error deleting default store:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

deleteDefaultStore()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })
