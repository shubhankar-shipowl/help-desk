import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
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

    const resolvedParams = await Promise.resolve(params)
    
    // Safety check: ensure ID is provided
    if (!resolvedParams.id || resolvedParams.id === 'undefined') {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 })
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: resolvedParams.id,
        tenantId, // Security: Only access tickets from same tenant
      },
      include: {
        User_Ticket_customerIdToUser: true,
        User_Ticket_assignedAgentIdToUser: true,
        Category: true,
        Comment: {
          include: {
            User: true,
            Attachment: true,
          },
          orderBy: { createdAt: 'asc' },
        },
        Attachment: true,
        TicketTag: {
          include: { Tag: true },
        },
      },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Check access
    if (session.user.role === 'CUSTOMER' && ticket.customerId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Convert Decimal to number for serialization and transform field names
    const serializedTicket = {
      ...ticket,
      refundAmount: ticket.refundAmount ? parseFloat(ticket.refundAmount.toString()) : null,
      customer: ticket.User_Ticket_customerIdToUser || null,
      category: ticket.Category || null,
      assignedAgent: ticket.User_Ticket_assignedAgentIdToUser || null,
      comments: ticket.Comment || [],
      attachments: ticket.Attachment || [],
      tags: (ticket.TicketTag || []).map((tt: any) => ({
        ...tt,
        tag: tt.Tag || null,
      })),
    }

    return NextResponse.json({ ticket: serializedTicket })
  } catch (error: any) {
    console.error('Error fetching ticket:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch ticket' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await Promise.resolve(params)
    
    // Safety check: ensure ID is provided
    if (!resolvedParams.id || resolvedParams.id === 'undefined') {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 })
    }

    const body = await req.json()
    const { status, priority, assignedAgentId, assignedTeamId, categoryId, dueDate } = body

    // Validate status is a valid TicketStatus
    const validStatuses = ['NEW', 'OPEN', 'IN_PROGRESS', 'PENDING', 'RESOLVED', 'CLOSED', 'INITIATE_REFUND']
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status: ${status}. Valid statuses are: ${validStatuses.join(', ')}` },
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

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: resolvedParams.id,
        tenantId, // Security: Only access tickets from same tenant
      },
      include: { customer: true },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    const updateData: any = {}
    const activityLogs: Array<{ action: string; description: string; metadata?: any }> = []

    if (status && status !== ticket.status) {
      updateData.status = status
      activityLogs.push({
        action: 'status_changed',
        description: `Status changed from ${ticket.status} to ${status}`,
        metadata: { from: ticket.status, to: status },
      })
    }
    
    if (priority && priority !== ticket.priority) {
      updateData.priority = priority
      activityLogs.push({
        action: 'priority_changed',
        description: `Priority changed from ${ticket.priority} to ${priority}`,
        metadata: { from: ticket.priority, to: priority },
      })
    }
    
    if (assignedAgentId !== undefined && assignedAgentId !== ticket.assignedAgentId) {
      updateData.assignedAgentId = assignedAgentId
      activityLogs.push({
        action: 'assigned',
        description: assignedAgentId 
          ? `Ticket assigned to agent` 
          : `Ticket unassigned from agent`,
        metadata: { from: ticket.assignedAgentId, to: assignedAgentId },
      })
    }
    
    if (assignedTeamId !== undefined && assignedTeamId !== ticket.assignedTeamId) {
      updateData.assignedTeamId = assignedTeamId
      activityLogs.push({
        action: 'team_assigned',
        description: assignedTeamId 
          ? `Ticket assigned to team` 
          : `Ticket unassigned from team`,
        metadata: { from: ticket.assignedTeamId, to: assignedTeamId },
      })
    }
    
    if (categoryId !== undefined) updateData.categoryId = categoryId
    if (dueDate !== undefined) updateData.dueDate = dueDate ? new Date(dueDate) : null
    
    if (status === 'RESOLVED' && !ticket.resolvedAt) {
      updateData.resolvedAt = new Date()
    }
    
    // Set first response time if this is the first comment/response
    if (!ticket.firstResponseAt && status && ['OPEN', 'IN_PROGRESS'].includes(status)) {
      updateData.firstResponseAt = new Date()
    }

    const updatedTicket = await prisma.ticket.update({
      where: { id: resolvedParams.id },
      data: updateData,
      include: {
        User_Ticket_customerIdToUser: true,
        User_Ticket_assignedAgentIdToUser: true,
        Team: true,
        Category: true,
        Attachment: true, // Include attachments to prevent them from being lost
      },
    })

    // Create activity logs
    for (const activity of activityLogs) {
      await prisma.ticketActivity.create({
        data: {
          ticketId: updatedTicket.id,
          userId: session.user.id,
          action: activity.action,
          description: activity.description,
          metadata: activity.metadata || {},
        },
      })
    }

    // Create notification for status change using notification triggers
    if (status && status !== ticket.status) {
      const { ticketNotificationTriggers } = await import('@/lib/notifications/triggers/ticketTriggers')
      
      // Get the user who made the change (for admin notifications)
      const changedBy = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: { id: true, name: true, email: true, role: true },
      })
      
      await ticketNotificationTriggers.onStatusChanged(updatedTicket, ticket.status, changedBy)
    }

    // Create notification for agent assignment/reassignment
    if (assignedAgentId !== undefined && assignedAgentId !== ticket.assignedAgentId) {
      const { ticketNotificationTriggers } = await import('@/lib/notifications/triggers/ticketTriggers')
      await ticketNotificationTriggers.onTicketAssigned(updatedTicket, session.user)
    }

    // Emit real-time update via WebSocket to all agents and admins
    try {
      const { emitToAgents, emitToAdmins, emitToUser } = await import('@/lib/notifications/websocket')
      
      // Fetch full ticket data with relations for WebSocket event
      const ticketForEvent = await prisma.ticket.findUnique({
        where: { id: updatedTicket.id },
        include: {
          User_Ticket_customerIdToUser: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          Category: true,
          User_Ticket_assignedAgentIdToUser: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          _count: {
            select: { Comment: true, Attachment: true },
          },
        },
      })

      if (ticketForEvent) {
        // Convert Decimal to number for serialization
        const serializedTicket = {
          ...ticketForEvent,
          refundAmount: ticketForEvent.refundAmount ? parseFloat(ticketForEvent.refundAmount.toString()) : null,
        }

        const updatePayload = {
          ticketId: serializedTicket.id,
          ticket: serializedTicket,
          updatedBy: {
            id: session.user.id,
            name: session.user.name,
            email: session.user.email,
          },
          changes: {
            status: status ? { from: ticket.status, to: status } : undefined,
            assignedAgentId: assignedAgentId !== undefined ? { from: ticket.assignedAgentId, to: assignedAgentId } : undefined,
            priority: priority ? { from: ticket.priority, to: priority } : undefined,
          },
        }

        // Emit ticket update to all agents (includes admins)
        emitToAgents('ticket:updated', updatePayload)

        // Also emit to admins room explicitly
        emitToAdmins('ticket:updated', updatePayload)

        // Emit to customer if status changed
        if (status && ticket.customerId) {
          emitToUser(ticket.customerId, 'ticket:updated', {
            ticketId: serializedTicket.id,
            ticket: serializedTicket,
            changes: {
              status: { from: ticket.status, to: status },
            },
          })
        }

        // Emit to assigned agent if assignment changed
        if (assignedAgentId !== undefined && assignedAgentId !== ticket.assignedAgentId && assignedAgentId) {
          emitToUser(assignedAgentId, 'ticket:updated', {
            ticketId: serializedTicket.id,
            ticket: serializedTicket,
            changes: {
              assignedAgentId: { from: ticket.assignedAgentId, to: assignedAgentId },
            },
          })
        }
      }
    } catch (error) {
      // Don't fail the request if WebSocket emission fails
      console.error('Error emitting ticket update via WebSocket:', error)
    }

    // Convert Decimal to number for serialization and transform field names
    const serializedTicket = {
      ...updatedTicket,
      refundAmount: updatedTicket.refundAmount ? parseFloat(updatedTicket.refundAmount.toString()) : null,
      customer: (updatedTicket as any).User_Ticket_customerIdToUser || null,
      category: (updatedTicket as any).Category || null,
      assignedAgent: (updatedTicket as any).User_Ticket_assignedAgentIdToUser || null,
    }

    return NextResponse.json({ ticket: serializedTicket })
  } catch (error: any) {
    console.error('Error updating ticket:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update ticket' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    // Only admins can delete tickets
    if (!session || session.user.role !== 'ADMIN') {
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

    const resolvedParams = await Promise.resolve(params)
    
    // Safety check: ensure ID is provided
    if (!resolvedParams.id || resolvedParams.id === 'undefined') {
      return NextResponse.json({ error: 'Ticket ID is required' }, { status: 400 })
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: resolvedParams.id },
      include: {
        Comment: {
          include: {
            Attachment: true,
          },
        },
        Attachment: true,
        TicketTag: true,
      },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Delete in order to respect foreign key constraints
    // 1. Delete notification delivery logs for ticket-related notifications
    const ticketNotifications = await prisma.notification.findMany({
      where: { ticketId: ticket.id },
      select: { id: true },
    })
    const notificationIds = ticketNotifications.map((n) => n.id)
    if (notificationIds.length > 0) {
      await prisma.notificationDeliveryLog.deleteMany({
        where: { notificationId: { in: notificationIds } },
      })
    }

    // 2. Delete ticket-related notifications
    await prisma.notification.deleteMany({
      where: { ticketId: ticket.id },
    })

    // 3. Delete satisfaction ratings
    await prisma.satisfactionRating.deleteMany({
      where: { ticketId: ticket.id },
    })

    // 4. Delete ticket tags
    await prisma.ticketTag.deleteMany({
      where: { ticketId: ticket.id },
    })

    // 5. Delete comment attachments
    for (const comment of ticket.Comment || []) {
      await prisma.attachment.deleteMany({
        where: { commentId: comment.id },
      })
    }

    // 6. Delete comments
    await prisma.comment.deleteMany({
      where: { ticketId: ticket.id },
    })

    // 7. Delete ticket attachments
    await prisma.attachment.deleteMany({
      where: { ticketId: ticket.id },
    })

    // 8. Delete the ticket
    await prisma.ticket.delete({
      where: {
        id: resolvedParams.id,
        tenantId, // Security: Only delete tickets from same tenant
      },
    })

    // Emit real-time update via WebSocket
    try {
      const { emitToAgents, emitToAdmins, emitToUser } = await import('@/lib/notifications/websocket')
      
      // Emit to all agents and admins (for inbox views)
      emitToAgents('ticket:deleted', { ticketId: ticket.id })
      emitToAdmins('ticket:deleted', { ticketId: ticket.id })
      
      // Emit specifically to assigned agent (if ticket was assigned)
      if (ticket.assignedAgentId) {
        emitToUser(ticket.assignedAgentId, 'ticket:deleted', { ticketId: ticket.id })
      }
      
      // Emit specifically to customer (if they're viewing their tickets)
      if (ticket.customerId) {
        emitToUser(ticket.customerId, 'ticket:deleted', { ticketId: ticket.id })
      }
    } catch (error) {
      console.error('[Delete Ticket] ❌ Error emitting ticket deletion via WebSocket:', error)
    }

    return NextResponse.json({ success: true, message: 'Ticket deleted successfully' })
  } catch (error: any) {
    console.error('Error deleting ticket:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete ticket' },
      { status: 500 }
    )
  }
}

