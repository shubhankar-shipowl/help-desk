import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get ticket statistics and analytics
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const teamId = searchParams.get('teamId')
    const storeId = searchParams.get('storeId')

    const dateFilter: any = {}
    if (startDate || endDate) {
      dateFilter.createdAt = {}
      if (startDate) dateFilter.createdAt.gte = new Date(startDate)
      if (endDate) dateFilter.createdAt.lte = new Date(endDate)
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const where: any = {
      tenantId, // Always filter by tenant
      ...dateFilter,
    }

    // For admins, storeId is required to filter data by store
    if (session.user.role === 'ADMIN') {
      if (!storeId) {
        return NextResponse.json(
          { error: 'Store ID is required for admin users' },
          { status: 400 }
        )
      }
      where.storeId = storeId
    } else if (storeId) {
      // For agents, storeId is optional
      where.storeId = storeId
    }

    // Filter by team if specified
    if (teamId) {
      where.assignedTeamId = teamId
    }

    // For agents, only show their assigned tickets
    if (session.user.role === 'AGENT') {
      where.assignedAgentId = session.user.id
    }

    // Get all tickets with filters
    const tickets = await prisma.ticket.findMany({
      where,
      select: {
        id: true,
        status: true,
        priority: true,
        source: true,
        createdAt: true,
        resolvedAt: true,
        firstResponseAt: true,
        assignedTeamId: true,
        categoryId: true,
      },
    })

    // Calculate statistics
    const totalTickets = tickets.length
    const openTickets = tickets.filter((t: any) => ['NEW', 'OPEN', 'IN_PROGRESS'].includes(t.status)).length
    const resolvedTickets = tickets.filter((t: any) => t.status === 'RESOLVED').length
    const closedTickets = tickets.filter((t: any) => t.status === 'CLOSED').length

    // By status
    const byStatus = {
      NEW: tickets.filter((t: any) => t.status === 'NEW').length,
      OPEN: tickets.filter((t: any) => t.status === 'OPEN').length,
      IN_PROGRESS: tickets.filter((t: any) => t.status === 'IN_PROGRESS').length,
      PENDING: tickets.filter((t: any) => t.status === 'PENDING').length,
      RESOLVED: resolvedTickets,
      CLOSED: closedTickets,
    }

    // By priority
    const byPriority = {
      URGENT: tickets.filter((t: any) => t.priority === 'URGENT').length,
      HIGH: tickets.filter((t: any) => t.priority === 'HIGH').length,
      NORMAL: tickets.filter((t: any) => t.priority === 'NORMAL').length,
      LOW: tickets.filter((t: any) => t.priority === 'LOW').length,
    }

    // By source
    const bySource = {
      EMAIL: tickets.filter((t: any) => t.source === 'EMAIL').length,
      FACEBOOK_POST: tickets.filter((t: any) => t.source === 'FACEBOOK_POST').length,
      FACEBOOK_COMMENT: tickets.filter((t: any) => t.source === 'FACEBOOK_COMMENT').length,
      FACEBOOK_MESSAGE: tickets.filter((t: any) => t.source === 'FACEBOOK_MESSAGE').length,
      MANUAL: tickets.filter((t: any) => t.source === 'MANUAL').length,
      API: tickets.filter((t: any) => t.source === 'API').length,
    }

    // Calculate average response time (in minutes)
    const ticketsWithFirstResponse = tickets.filter((t: any) => t.firstResponseAt && t.createdAt)
    const avgResponseTime = ticketsWithFirstResponse.length > 0
      ? ticketsWithFirstResponse.reduce((sum: number, t: any) => {
          const responseTime = (new Date(t.firstResponseAt!).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60)
          return sum + responseTime
        }, 0) / ticketsWithFirstResponse.length
      : 0

    // Calculate average resolution time (in minutes)
    const resolvedTicketsWithTime = tickets.filter((t: any) => t.resolvedAt && t.createdAt)
    const avgResolutionTime = resolvedTicketsWithTime.length > 0
      ? resolvedTicketsWithTime.reduce((sum: number, t: any) => {
          const resolutionTime = (new Date(t.resolvedAt!).getTime() - new Date(t.createdAt).getTime()) / (1000 * 60)
          return sum + resolutionTime
        }, 0) / resolvedTicketsWithTime.length
      : 0

    // Overdue tickets
    const now = new Date()
    const overdueTickets = tickets.filter((t: any) => {
      if (!t.resolvedAt && ['NEW', 'OPEN', 'IN_PROGRESS'].includes(t.status)) {
        // Check if ticket has a due date and is past due
        // This would require fetching full tickets with dueDate
        return false // Placeholder - would need full ticket data
      }
      return false
    }).length

    // Tickets by day (last 30 days)
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date()
      date.setDate(date.getDate() - (29 - i))
      return date.toISOString().split('T')[0]
    })

    const ticketsByDay = last30Days.map((date: string) => {
      const dayStart = new Date(date)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(date)
      dayEnd.setHours(23, 59, 59, 999)

      return {
        date,
        count: tickets.filter((t: any) => {
          const ticketDate = new Date(t.createdAt)
          return ticketDate >= dayStart && ticketDate <= dayEnd
        }).length,
      }
    })

    return NextResponse.json({
      summary: {
        total: totalTickets,
        open: openTickets,
        resolved: resolvedTickets,
        closed: closedTickets,
        overdue: overdueTickets,
        avgResponseTime: Math.round(avgResponseTime),
        avgResolutionTime: Math.round(avgResolutionTime),
      },
      byStatus,
      byPriority,
      bySource,
      ticketsByDay,
    })
  } catch (error: any) {
    console.error('Error fetching ticket statistics:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch statistics' },
      { status: 500 }
    )
  }
}

