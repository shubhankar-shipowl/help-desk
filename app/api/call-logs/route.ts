import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get call logs
 * Only agents and admins can view call logs
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const ticketId = searchParams.get('ticketId')
    const agentId = searchParams.get('agentId')
    const customerPhone = searchParams.get('customerPhone')
    const status = searchParams.get('status')
    const remark = searchParams.get('remark')
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const skip = (page - 1) * limit

    // Build where clause - filter by tenant through agent
    const where: any = {
      agent: {
        tenantId, // Filter by tenant through agent relation
      },
    }

    // If agent, only show their own calls (unless admin)
    if (session.user.role === 'AGENT') {
      where.agentId = session.user.id
    } else if (agentId) {
      // Admin can filter by agent
      where.agentId = agentId
    }

    if (ticketId) {
      where.ticketId = ticketId
    }

    if (customerPhone) {
      where.customerPhone = {
        contains: customerPhone,
      }
    }

    if (status) {
      where.status = status
    }

    // Remark filter
    if (remark) {
      if (remark === 'HAS_REMARK') {
        where.AND = [
          { remark: { not: null } },
          { remark: { not: '' } },
          { remark: { not: '-' } },
        ]
      } else if (remark === 'NO_REMARK') {
        where.OR = [
          { remark: null },
          { remark: '' },
          { remark: '-' },
        ]
      }
    }

    // Date range filter
    if (startDate || endDate) {
      where.startedAt = {}
      if (startDate) {
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        where.startedAt.gte = start
      }
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        where.startedAt.lte = end
      }
    }

    // Build where clause for dates (without agent restriction for calendar dots)
    const datesWhere: any = {
      agent: {
        tenantId, // Filter by tenant through agent relation
      },
    }
    if (session.user.role === 'AGENT') {
      datesWhere.agentId = session.user.id
    }

    // Fetch call logs with related data
    const [callLogs, total, allCallLogs] = await Promise.all([
      prisma.callLog.findMany({
        where,
        include: {
          agent: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          ticket: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true,
            },
          },
        },
        orderBy: {
          startedAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.callLog.count({ where }),
      // Get all call logs to extract unique dates (for calendar dots)
      prisma.callLog.findMany({
        where: datesWhere,
        select: {
          startedAt: true,
        },
      }),
    ])

    // Format duration for display
    const formattedLogs = callLogs.map((log) => {
      const minutes = Math.floor(log.duration / 60)
      const seconds = log.duration % 60
      const durationFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`

      return {
        id: log.id,
        ticketId: log.ticketId,
        ticketNumber: log.ticket?.ticketNumber,
        ticketSubject: log.ticket?.subject,
        agentId: log.agentId,
        agentName: log.agent.name,
        agentEmail: log.agent.email,
        customerName: log.customerName,
        customerPhone: log.customerPhone,
        agentPhone: log.agentPhone,
        status: log.status,
        duration: log.duration,
        durationFormatted,
        attempts: log.attempts,
        remark: log.remark || '-',
        exotelCallId: log.exotelCallId,
        startedAt: log.startedAt,
        endedAt: log.endedAt,
        createdAt: log.createdAt,
      }
    })

    // Extract unique dates with call logs
    const datesWithData = new Set<string>()
    allCallLogs.forEach((log) => {
      if (log.startedAt) {
        const dateStr = log.startedAt.toISOString().split('T')[0]
        datesWithData.add(dateStr)
      }
    })

    return NextResponse.json({
      callLogs: formattedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      datesWithData: Array.from(datesWithData),
    })
  } catch (error: any) {
    console.error('Error fetching call logs:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch call logs' },
      { status: 500 }
    )
  }
}

