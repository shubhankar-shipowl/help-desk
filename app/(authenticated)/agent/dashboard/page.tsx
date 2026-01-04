import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { TicketStatus } from '@prisma/client'
import { DashboardStats } from '@/components/dashboard/dashboard-stats'
import { TicketVolumeChart } from '@/components/charts/ticket-volume-chart'
import { CategoryPieChart } from '@/components/charts/category-pie-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'
import { AgentDashboardWrapper } from '@/components/agent/agent-dashboard-wrapper'

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

  let openTickets = 0
  let assignedTickets = 0
  let resolvedToday = 0
  let totalTickets = 0
  let urgentTickets = 0
  let resolvedTicketsForAvg: any[] = []
  let recentTickets: any[] = []
  let averageResolutionTime: number | undefined = undefined
  let ticketVolumeData: any[] = []
  let categoryChartData: any[] = []

  try {
    const [
      openTicketsResult,
      assignedTicketsResult,
      resolvedTodayResult,
      totalTicketsResult,
      urgentTicketsResult,
      resolvedTicketsForAvgResult,
    ] = await Promise.all([
    prisma.ticket.count({
      where: {
        status: { in: [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        ...(session.user.role === 'AGENT' ? { assignedAgentId: session.user.id } : {}),
      },
    }),
    prisma.ticket.count({
      where: {
        assignedAgentId: session.user.id,
        status: { in: [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
      },
    }),
    prisma.ticket.count({
      where: {
        assignedAgentId: session.user.id,
        status: TicketStatus.RESOLVED,
        resolvedAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
        },
      },
    }),
    prisma.ticket.count({
      ...(session.user.role === 'AGENT' ? { where: { assignedAgentId: session.user.id } } : {}),
    }),
    prisma.ticket.count({
      where: {
        priority: 'URGENT',
        status: { in: [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        ...(session.user.role === 'AGENT' ? { assignedAgentId: session.user.id } : {}),
      },
    }),
      prisma.ticket.findMany({
        where: {
          assignedAgentId: session.user.id,
          status: TicketStatus.RESOLVED,
          resolvedAt: { not: null },
        },
        select: {
          createdAt: true,
          resolvedAt: true,
        },
        take: 100, // Sample for average calculation
      }),
    ])

    openTickets = openTicketsResult
    assignedTickets = assignedTicketsResult
    resolvedToday = resolvedTodayResult
    totalTickets = totalTicketsResult
    urgentTickets = urgentTicketsResult
    resolvedTicketsForAvg = resolvedTicketsForAvgResult

    // Calculate average resolution time in hours
    if (resolvedTicketsForAvg.length > 0) {
      const totalHours = resolvedTicketsForAvg.reduce((sum, ticket) => {
        if (ticket.resolvedAt && ticket.createdAt) {
          const hours = (ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) / (1000 * 60 * 60)
          return sum + hours
        }
        return sum
      }, 0)
      averageResolutionTime = totalHours / resolvedTicketsForAvg.length
    }

    recentTickets = await prisma.ticket.findMany({
    where: {
      ...(session.user.role === 'AGENT' ? { assignedAgentId: session.user.id } : {}),
    },
    include: {
      customer: {
        select: { name: true, email: true },
      },
      category: true,
      assignedAgent: {
        select: { name: true, email: true },
      },
      _count: {
        select: { comments: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

    // Get ticket volume data for last 7 days
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date()
      date.setDate(date.getDate() - (6 - i))
      return date.toISOString().split('T')[0]
    })

    ticketVolumeData = await Promise.all(
      last7Days.map(async (date) => {
        try {
          const startOfDay = new Date(date)
          startOfDay.setHours(0, 0, 0, 0)
          const endOfDay = new Date(date)
          endOfDay.setHours(23, 59, 59, 999)

          const [created, resolved] = await Promise.all([
            prisma.ticket.count({
              where: {
                createdAt: { gte: startOfDay, lte: endOfDay },
                ...(session.user.role === 'AGENT' ? { assignedAgentId: session.user.id } : {}),
              },
            }),
            prisma.ticket.count({
              where: {
                resolvedAt: { gte: startOfDay, lte: endOfDay },
                ...(session.user.role === 'AGENT' ? { assignedAgentId: session.user.id } : {}),
              },
            }),
          ])

          return {
            date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            created,
            resolved,
          }
        } catch (error) {
          return {
            date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            created: 0,
            resolved: 0,
          }
        }
      })
    )

    // Get category distribution
    const categoryData = await prisma.ticket.groupBy({
      by: ['categoryId'],
      where: {
        ...(session.user.role === 'AGENT' ? { assignedAgentId: session.user.id } : {}),
      },
      _count: true,
    })

    const categories = await prisma.category.findMany({
      where: { id: { in: categoryData.map((c) => c.categoryId).filter(Boolean) as string[] } },
    })

    categoryChartData = categoryData.map((item) => {
      const category = categories.find((c) => c.id === item.categoryId)
      return {
        name: category?.name || 'Uncategorized',
        value: item._count,
        color: category?.color || '#3B82F6',
      }
    })
  } catch (error: any) {
    console.error('Database connection error:', error.message)
    // Use default values - the page will still render with zeros
    // Initialize fallback data if not already set
    if (!ticketVolumeData || ticketVolumeData.length === 0) {
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date()
        date.setDate(date.getDate() - (6 - i))
        return date.toISOString().split('T')[0]
      })
      ticketVolumeData = last7Days.map((date) => ({
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        created: 0,
        resolved: 0,
      }))
    }
    if (!categoryChartData || categoryChartData.length === 0) {
      categoryChartData = []
    }
  }

  return (
    <AgentDashboardWrapper userPhone={user?.phone} userId={session.user.id}>
      <div>
        <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-h1 mb-2">Dashboard</h1>
          <p className="text-gray-600">Overview of your support tickets and activity</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-10 px-4 border border-gray-300 rounded-lg bg-white text-sm">
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
          </select>
        </div>
      </div>

      <DashboardStats
        openTickets={openTickets}
        assignedTickets={assignedTickets}
        resolvedToday={resolvedToday}
        totalTickets={totalTickets}
        urgentTickets={urgentTickets}
        averageResolutionTime={averageResolutionTime}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="lg:col-span-2 border border-gray-200 shadow-sm">
          <CardHeader className="border-b border-gray-200">
            <CardTitle className="text-h3">Ticket Volume</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {ticketVolumeData.length > 0 ? (
              <TicketVolumeChart data={ticketVolumeData} />
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-gray-200 shadow-sm">
          <CardHeader className="border-b border-gray-200">
            <CardTitle className="text-h3">Tickets by Category</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {categoryChartData.length > 0 ? (
              <CategoryPieChart data={categoryChartData} />
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border border-gray-200 shadow-sm">
        <CardHeader className="border-b border-gray-200 flex flex-row items-center justify-between">
          <CardTitle className="text-h3">Recent Tickets</CardTitle>
          <Link href="/agent/tickets" className="text-sm text-primary hover:underline">
            View all →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {recentTickets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No tickets yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {recentTickets.slice(0, 5).map((ticket) => (
              <Link
                key={ticket.id}
                href={`/agent/tickets/${ticket.id}`}
                className="block p-4 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1">
                    <span className="font-mono text-sm text-gray-500">#{ticket.ticketNumber}</span>
                    <span className="font-medium text-gray-900">{ticket.subject}</span>
                    <Badge
                      className={
                        ticket.priority === 'URGENT'
                          ? 'bg-red-600 text-white'
                          : ticket.priority === 'HIGH'
                          ? 'bg-orange-500 text-white'
                          : ticket.priority === 'NORMAL'
                          ? 'bg-primary text-white'
                          : 'bg-gray-500 text-white'
                      }
                    >
                      {ticket.priority}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-sm text-gray-600">
                    <span>{ticket.customer.name || ticket.customer.email}</span>
                    <span>{formatRelativeTime(ticket.createdAt)}</span>
                  </div>
                </div>
              </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
    </AgentDashboardWrapper>
  )
}

