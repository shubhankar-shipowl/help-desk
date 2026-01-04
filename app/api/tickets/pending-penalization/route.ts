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
    const where = {
      tenantId, // Always filter by tenant
      status: 'RESOLVED',
      isPenalized: false,
      resolvedAt: {
        gte: dateThreshold,
      },
    }

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          category: {
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
      customerName: ticket.customer.name || ticket.customer.email,
      customerEmail: ticket.customer.email,
      issueType: ticket.subject,
      category: ticket.category?.name || 'N/A',
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

