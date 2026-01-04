import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get ticket activities
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const ticketId = searchParams.get('ticketId')

    if (!ticketId) {
      return NextResponse.json(
        { error: 'ticketId is required' },
        { status: 400 }
      )
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Verify user has access to this ticket
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        tenantId, // Security: Only access tickets from same tenant
      },
      select: { assignedAgentId: true, customerId: true },
    })

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      )
    }

    // Check access
    if (session.user.role === 'AGENT' && ticket.assignedAgentId !== session.user.id && ticket.assignedAgentId !== null) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const activities = await prisma.ticketActivity.findMany({
      where: { ticketId },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ activities })
  } catch (error: any) {
    console.error('Error fetching activities:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch activities' },
      { status: 500 }
    )
  }
}

/**
 * Create ticket activity
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { ticketId, action, description, metadata } = body

    if (!ticketId || !action || !description) {
      return NextResponse.json(
        { error: 'ticketId, action, and description are required' },
        { status: 400 }
      )
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Verify user has access to this ticket
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: ticketId,
        tenantId, // Security: Only access tickets from same tenant
      },
      select: { assignedAgentId: true },
    })

    if (!ticket) {
      return NextResponse.json(
        { error: 'Ticket not found' },
        { status: 404 }
      )
    }

    const activity = await prisma.ticketActivity.create({
      data: {
        ticketId,
        userId: session.user.id,
        action,
        description,
        metadata: metadata || {},
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
    })

    return NextResponse.json({ activity })
  } catch (error: any) {
    console.error('Error creating activity:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create activity' },
      { status: 500 }
    )
  }
}

