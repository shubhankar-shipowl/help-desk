import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function checkUser() {
  // Use findFirst since email is part of compound unique with tenantId
  const user = await prisma.user.findFirst({
    where: { email: 'admin@example.com' },
  })

  if (!user) {
    console.log('❌ User not found!')
    return
  }

  console.log('✅ User found:')
  console.log('  Email:', user.email)
  console.log('  Name:', user.name)
  console.log('  Role:', user.role)
  console.log('  Is Active:', user.isActive)
  console.log('  Has Password:', !!user.password)
  
  if (user.password) {
    const isValid = await bcrypt.compare('password123', user.password)
    console.log('  Password "password123" is valid:', isValid)
    
    const isInvalid = await bcrypt.compare('123', user.password)
    console.log('  Password "123" is valid:', isInvalid)
  }
}

checkUser()
  .catch(console.error)
  .finally(() => prisma.$disconnect())

