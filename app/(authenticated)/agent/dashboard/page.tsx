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
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { phone: true },
  })

  return (
    <AgentDashboardWrapper userPhone={user?.phone} userId={session.user.id}>
      <DashboardContent />
    </AgentDashboardWrapper>
  )
}

