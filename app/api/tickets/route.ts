import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateTicketNumber } from '@/lib/utils'
import { autoAssignTicket, sendTicketAcknowledgment } from '@/lib/automation'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'CUSTOMER') {
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

    const body = await req.json()
    const { subject, description, categoryId, priority } = body

    if (!subject || !description) {
      return NextResponse.json(
        { error: 'Subject and description are required' },
        { status: 400 }
      )
    }

    const ticket = await prisma.ticket.create({
      data: {
        tenantId, // Multi-tenant: Always include tenantId
        ticketNumber: generateTicketNumber(),
        subject,
        description,
        categoryId: categoryId || null,
        priority: priority || 'NORMAL',
        customerId: session.user.id,
        status: 'NEW',
      },
      include: {
        category: true,
        customer: true,
      },
    })

    // Auto-assign ticket
    const assignedAgent = await autoAssignTicket(ticket.id)

    // Fetch full ticket with relations for notifications
    const fullTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: {
        customer: true,
        category: true,
        assignedAgent: true,
      },
    })

    if (fullTicket) {
      // Trigger notification using notification service
      // Note: onTicketAssigned was already called by autoAssignTicket, so we don't call it again
      const { ticketNotificationTriggers } = await import('@/lib/notifications/triggers/ticketTriggers')
      await ticketNotificationTriggers.onTicketCreated(fullTicket)
    }

    // Send acknowledgment email
    await sendTicketAcknowledgment(ticket.id)

    // Emit real-time ticket creation event via WebSocket
    try {
      const { getIO } = await import('@/lib/notifications/websocket')
      const io = getIO()
      
      if (io && fullTicket) {
        // Fetch ticket with all relations for WebSocket event
        const ticketForEvent = await prisma.ticket.findUnique({
          where: { id: ticket.id },
          include: {
            customer: {
              select: { id: true, name: true, email: true, avatar: true },
            },
            category: true,
            assignedAgent: {
              select: { id: true, name: true, email: true, avatar: true },
            },
            _count: {
              select: { comments: true, attachments: true },
            },
          },
        })

        if (ticketForEvent) {
          // Emit to all agents and admins
          io.to('agents').emit('ticket:created', {
            ticket: ticketForEvent,
          })
          io.to('admins').emit('ticket:created', {
            ticket: ticketForEvent,
          })
        }
      }
    } catch (error) {
      console.error('Error emitting ticket creation via WebSocket:', error)
    }

    return NextResponse.json({ ticket }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating ticket:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create ticket' },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
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
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')
    const categoryId = searchParams.get('categoryId')
    const customerId = searchParams.get('customerId')

    const where: any = {
      tenantId, // Always filter by tenant
    }

    // If customerId is provided in query params, use it (for admins/agents viewing customer tickets)
    if (customerId && (session.user.role === 'ADMIN' || session.user.role === 'AGENT')) {
      where.customerId = customerId
    } else if (session.user.role === 'CUSTOMER') {
      where.customerId = session.user.id
    } else if (session.user.role === 'AGENT') {
      where.assignedAgentId = session.user.id
    }

    // Handle status filter - can be comma-separated string or single value
    if (status) {
      if (status.includes(',')) {
        // Multiple statuses: use Prisma's 'in' operator
        const statusArray = status.split(',').map(s => s.trim()).filter(Boolean)
        if (statusArray.length > 0) {
          where.status = { in: statusArray }
        }
      } else {
        // Single status
        where.status = status
      }
    }

    // Handle priority filter - can be comma-separated string or single value
    if (priority) {
      if (priority.includes(',')) {
        // Multiple priorities: use Prisma's 'in' operator
        const priorityArray = priority.split(',').map(p => p.trim()).filter(Boolean)
        if (priorityArray.length > 0) {
          where.priority = { in: priorityArray }
        }
      } else {
        // Single priority
        where.priority = priority
      }
    }

    if (categoryId) where.categoryId = categoryId

    const tickets = await prisma.ticket.findMany({
      where,
      select: {
        id: true,
        ticketNumber: true,
        subject: true,
        status: true,
        priority: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        customerId: true,
        customer: {
          select: { name: true, email: true },
        },
        category: true,
        assignedAgent: {
          select: { name: true, email: true },
        },
        _count: {
          select: { comments: true, attachments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ tickets })
  } catch (error: any) {
    console.error('Error fetching tickets:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch tickets' },
      { status: 500 }
    )
  }
}

