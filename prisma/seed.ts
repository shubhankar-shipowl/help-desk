import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('Seeding database...')

  // Create default tenant first
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
      tenantId: defaultTenant.id,
      email: 'admin@example.com',
      name: 'Admin User',
      password: adminPassword,
      role: 'ADMIN',
      isActive: true,
    },
  })
  console.log(`✓ Created admin user: ${admin.email}`)

  // Create default categories
  const defaultCategories = [
    // Parent Categories (with emojis in names)
    { 
      name: '📦 Order & Product Issues', 
      icon: '📦', 
      color: '#EF4444', 
      description: 'Issues related to orders and products',
      subjects: [
        'Wrong Product Delivered',
        'Missing Item in Order',
        'Damaged Product Received',
        'Defective Product',
        'Product Not as Described'
      ]
    },
    { 
      name: '🔄 Return / Refund / Replacement', 
      icon: '🔄', 
      color: '#F59E0B', 
      description: 'Return, refund, and replacement requests',
      subjects: [
        'Return Request',
        'Refund Request',
        'Replacement Request',
        'Refund Not Received',
        'Return Pickup Issue'
      ]
    },
    { 
      name: '🚚 Delivery Issues', 
      icon: '🚚', 
      color: '#3B82F6', 
      description: 'Issues related to order delivery',
      subjects: [
        'Order Not Delivered',
        'Delayed Delivery',
        'Tracking Issue',
        'Delivery Address Change Request'
      ]
    },
    { 
      name: '💳 Payment Issues', 
      icon: '💳', 
      color: '#8B5CF6', 
      description: 'Issues related to payments and billing',
      subjects: [
        'Payment Failed',
        'Amount Debited but Order Not Placed',
        'Invoice / Billing Issue'
      ]
    },
  ]

  // Create categories (check if exists first to avoid duplicates)
  console.log('Creating default categories...')
  for (const category of defaultCategories) {
    const existing = await prisma.category.findFirst({
      where: {
        tenantId: defaultTenant.id,
        name: category.name,
      },
    })
    
    if (!existing) {
      await prisma.category.create({
        data: {
          tenantId: defaultTenant.id,
          name: category.name,
          icon: category.icon,
          color: category.color,
          description: category.description,
          subjects: category.subjects || null,
        },
      })
      console.log(`  ✓ Created category: ${category.name}`)
    } else {
      // Update existing category with subjects if they don't have any
      if (!existing.subjects && category.subjects) {
        await prisma.category.update({
          where: { id: existing.id },
          data: { subjects: category.subjects },
        })
        console.log(`  ✓ Updated category with subjects: ${category.name}`)
      } else {
        console.log(`  - Skipped (already exists): ${category.name}`)
      }
    }
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

