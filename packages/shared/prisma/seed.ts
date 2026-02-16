import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { DEFAULT_CATEGORIES, createDefaultCategoriesForStore } from '../lib/default-categories'
import crypto from 'crypto'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create default tenant first
  const defaultTenant = await prisma.tenant.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      name: 'Default Company',
      slug: 'default',
      isActive: true,
      settings: {},
      updatedAt: new Date(),
    },
  })
  console.log(`✓ Created default tenant: ${defaultTenant.name}`)

  // Create admin user only
  const adminPassword = await bcrypt.hash('password123', 10)
  const admin = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: defaultTenant.id,
        email: 'admin@example.com',
      },
    },
    update: {},
    create: {
      id: crypto.randomUUID(),
      tenantId: defaultTenant.id,
      email: 'admin@example.com',
      name: 'Admin User',
      password: adminPassword,
      role: 'ADMIN',
      isActive: true,
      updatedAt: new Date(),
    },
  })
  console.log(`✓ Created admin user: ${admin.email}`)

  // Get all stores for this tenant
  const stores = await prisma.store.findMany({
    where: {
      tenantId: defaultTenant.id,
      isActive: true,
    },
  })
  console.log(`Found ${stores.length} active store(s)`)

  // Create categories for each store and tenant-level
  console.log('Creating default categories...')
  
  // First, create tenant-level categories (available to all stores)
  console.log('  Creating tenant-level categories...')
  await createDefaultCategoriesForStore(defaultTenant.id, null, prisma)
  console.log('    ✓ Created tenant-level categories')

  // Then, create store-specific categories for each store
  if (stores.length > 0) {
    console.log('  Creating store-specific categories...')
    for (const store of stores) {
      await createDefaultCategoriesForStore(defaultTenant.id, store.id, prisma)
      console.log(`    ✓ Created categories for store: ${store.name}`)
    }
  } else {
    console.log('  No stores found. Categories created at tenant level only.')
  }

  console.log('')
  console.log('✅ Database seeded successfully!')
  console.log('')
  console.log('👤 Default user created:')
  console.log('   Admin: admin@example.com / password123')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

