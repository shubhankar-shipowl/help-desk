import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function createAdmin() {
  try {
    console.log('🔐 Creating admin account...')

    // Find or create default tenant
    let tenant = await prisma.tenant.findUnique({
      where: { slug: 'default' },
    })

    if (!tenant) {
      console.log('📦 Creating default tenant...')
      tenant = await prisma.tenant.create({
        data: {
          name: 'Default Company',
          slug: 'default',
          isActive: true,
          settings: {},
        },
      })
      console.log(`✅ Created default tenant: ${tenant.id}`)
    }

    const email = 'Shopperskart@support.com'
    const password = 'Shipowl@6'

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Check if admin already exists
    const existingAdmin = await prisma.user.findFirst({
      where: {
        tenantId: tenant.id,
        email: email,
      },
    })

    if (existingAdmin) {
      // Update existing admin
      const updated = await prisma.user.update({
        where: { id: existingAdmin.id },
        data: {
          password: hashedPassword,
          role: 'ADMIN',
          isActive: true,
        },
      })
      console.log(`✅ Updated existing admin account:`)
      console.log(`   Email: ${updated.email}`)
      console.log(`   Name: ${updated.name || 'N/A'}`)
      console.log(`   Role: ${updated.role}`)
      console.log(`   Tenant: ${tenant.name}`)
    } else {
      // Create new admin
      const admin = await prisma.user.create({
        data: {
          tenantId: tenant.id,
          email: email,
          name: 'Admin',
          password: hashedPassword,
          role: 'ADMIN',
          isActive: true,
        },
      })
      console.log(`✅ Created admin account:`)
      console.log(`   Email: ${admin.email}`)
      console.log(`   Name: ${admin.name}`)
      console.log(`   Role: ${admin.role}`)
      console.log(`   Tenant: ${tenant.name}`)
    }

    console.log('')
    console.log('📋 Login Credentials:')
    console.log(`   Email: ${email}`)
    console.log(`   Password: ${password}`)
    console.log('')
    console.log('✅ Admin account ready!')
  } catch (error) {
    console.error('❌ Error creating admin:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

// Run script
createAdmin()
  .then(() => {
    console.log('Script completed successfully')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Script failed:', error)
    process.exit(1)
  })
