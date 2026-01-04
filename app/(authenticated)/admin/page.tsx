import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { AdminDashboard } from '@/components/admin/admin-dashboard'

export default async function AdminPage() {
  const session = await getServerSession(authOptions)

  if (!session || session.user.role !== 'ADMIN') {
    redirect('/auth/signin')
  }

  const [
    totalTickets,
    openTickets,
    resolvedTickets,
    totalUsers,
    totalAgents,
    totalCustomers,
    averageResolutionTime,
    csatAverage,
  ] = await Promise.all([
    prisma.ticket.count(),
    prisma.ticket.count({
      where: {
        status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] },
      },
    }),
    prisma.ticket.count({
      where: { status: 'RESOLVED' },
    }),
    prisma.user.count(),
    prisma.user.count({ where: { role: 'AGENT' } }),
    prisma.user.count({ where: { role: 'CUSTOMER' } }),
    (async () => {
      const resolvedTickets = await prisma.ticket.findMany({
        where: {
          resolvedAt: { not: null },
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
          },
        },
        select: {
          createdAt: true,
          resolvedAt: true,
        },
      })
      
      if (resolvedTickets.length === 0) return 0
      
      const totalTime = resolvedTickets.reduce((sum, ticket) => {
        if (ticket.resolvedAt) {
          return sum + (ticket.resolvedAt.getTime() - ticket.createdAt.getTime())
        }
        return sum
      }, 0)
      
      return totalTime / resolvedTickets.length / (1000 * 60 * 60) // Convert to hours
    })(),
    prisma.satisfactionRating
      .aggregate({
        _avg: { rating: true },
      })
      .then((result) => result._avg.rating || 0),
  ])

  // Get recent tickets
  const recentTickets = await prisma.ticket.findMany({
    take: 10,
    include: {
      customer: { select: { name: true, email: true } },
      assignedAgent: { select: { name: true, email: true } },
      category: true,
    },
    orderBy: { createdAt: 'desc' },
  })

  // Get agent performance
  const agentPerformance = await prisma.user.findMany({
    where: { role: 'AGENT' },
    include: {
      assignedTickets: {
        where: {
          status: 'RESOLVED',
          resolvedAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      },
      _count: {
        select: {
          assignedTickets: {
            where: {
              status: { in: ['NEW', 'OPEN', 'PENDING'] },
            },
          },
        },
      },
    },
  })

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          System overview and management
        </p>
      </div>
      <AdminDashboard
        stats={{
          totalTickets,
          openTickets,
          resolvedTickets,
          totalUsers,
          totalAgents,
          totalCustomers,
          csatAverage: csatAverage || 0,
          averageResolutionTime: averageResolutionTime || 0,
        }}
        recentTickets={recentTickets}
        agentPerformance={agentPerformance}
      />
    </div>
  )
}

