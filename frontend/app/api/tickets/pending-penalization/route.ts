import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get fresh resolved tickets pending penalization
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const days = parseInt(searchParams.get('days') || '7') // Default: last 7 days
    const storeId = searchParams.get('storeId')

    const skip = (page - 1) * limit

    // Calculate date threshold
    const dateThreshold = new Date()
    dateThreshold.setDate(dateThreshold.getDate() - days)
    dateThreshold.setHours(0, 0, 0, 0)

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Fetch resolved tickets that are NOT penalized, resolved within the last N days
    const where: any = {
      tenantId, // Always filter by tenant
      status: 'RESOLVED' as const,
      isPenalized: false,
      resolvedAt: {
        gte: dateThreshold,
      },
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

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: {
          User_Ticket_customerIdToUser: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          Category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        orderBy: {
          resolvedAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.ticket.count({ where }),
    ])

    const formattedTickets = tickets.map((ticket) => ({
      id: ticket.id,
      ticketNumber: ticket.ticketNumber,
      customerName: ticket.User_Ticket_customerIdToUser?.name || ticket.User_Ticket_customerIdToUser?.email,
      customerEmail: ticket.User_Ticket_customerIdToUser?.email,
      issueType: ticket.subject,
      category: ticket.Category?.name || 'N/A',
      priority: ticket.priority,
      resolvedAt: ticket.resolvedAt,
      createdAt: ticket.createdAt,
      // Calculate days since resolution
      daysSinceResolution: ticket.resolvedAt
        ? Math.floor((Date.now() - ticket.resolvedAt.getTime()) / (1000 * 60 * 60 * 24))
        : 0,
    }))

    return NextResponse.json({
      tickets: formattedTickets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error: any) {
    console.error('Error fetching pending penalization tickets:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch tickets' },
      { status: 500 }
    )
  }
}

