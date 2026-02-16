import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { AgentDashboardWrapper } from '@/components/agent/agent-dashboard-wrapper'
import { DashboardContent } from '@/components/dashboard/dashboard-content'

export default async function AgentDashboardPage() {
  const session = await getServerSession(authOptions)

  if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
    redirect('/auth/signin')
  }

  // Fetch user phone number for phone configuration check
  // Handle database connection errors gracefully
  let user = null
  try {
    user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phone: true },
    })
  } catch (error: any) {
    console.error('[Dashboard] Database connection error:', error.message)
    
    // Check if it's a connection error
    if (
      error.message?.includes('Can\'t reach database server') ||
      error.message?.includes('P1001') ||
      error.code === 'P1001'
    ) {
      // Database server is unreachable
      const dbHost = process.env.DB_HOST || 'unknown'
      const dbPort = process.env.DB_PORT || '3306'
      const usingDbVars = process.env.DB_HOST && !process.env.DATABASE_URL
      
      throw new Error(
        `Database connection failed to ${dbHost}:${dbPort}. Please check:\n` +
        '1. Database server is running and accessible\n' +
        '2. Network connectivity (ping/port test)\n' +
        `3. Database configuration in .env:\n` +
        `   ${usingDbVars ? '   - DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME' : '   - DATABASE_URL (or DB_* variables)'}\n` +
        '4. Firewall allows connections to the database server\n' +
        '5. Database credentials are correct\n\n' +
        `Current config: ${usingDbVars ? 'Using DB_* variables' : 'Using DATABASE_URL'}`
      )
    }
    
    // Re-throw other errors
    throw error
  }

  return (
    <AgentDashboardWrapper userPhone={user?.phone} userId={session.user.id}>
      <DashboardContent />
    </AgentDashboardWrapper>
  )
}

