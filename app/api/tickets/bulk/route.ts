import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Ticket_status, Ticket_priority } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Bulk update tickets
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { ticketIds, updates } = body

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return NextResponse.json(
        { error: 'ticketIds array is required' },
        { status: 400 }
      )
    }

    if (!updates || Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'Updates object is required' },
        { status: 400 }
      )
    }

    // Verify user has access to all tickets
    const tickets = await prisma.ticket.findMany({
      where: {
        id: { in: ticketIds },
      },
      select: {
        id: true,
        assignedAgentId: true,
      },
    })

    if (tickets.length !== ticketIds.length) {
      return NextResponse.json(
        { error: 'Some tickets not found' },
        { status: 404 }
      )
    }

    // For agents, verify they have access
    if (session.user.role === 'AGENT') {
      const unauthorizedTickets = tickets.filter(
        t => t.assignedAgentId !== session.user.id && t.assignedAgentId !== null
      )
      if (unauthorizedTickets.length > 0) {
        return NextResponse.json(
          { error: 'Unauthorized access to some tickets' },
          { status: 403 }
        )
      }
    }

    // Prepare update data
    const updateData: any = {}
    const activityLogs: Array<{ ticketId: string; action: string; description: string; metadata?: any }> = []

    if (updates.status) {
      updateData.status = updates.status as Ticket_status
      tickets.forEach(ticket => {
        activityLogs.push({
          ticketId: ticket.id,
          action: 'status_changed',
          description: `Status changed to ${updates.status} (bulk update)`,
          metadata: { to: updates.status, bulk: true },
        })
      })
    }

    if (updates.priority) {
      updateData.priority = updates.priority as Ticket_priority
      tickets.forEach(ticket => {
        activityLogs.push({
          ticketId: ticket.id,
          action: 'priority_changed',
          description: `Priority changed to ${updates.priority} (bulk update)`,
          metadata: { to: updates.priority, bulk: true },
        })
      })
    }

    if (updates.assignedAgentId !== undefined) {
      updateData.assignedAgentId = updates.assignedAgentId
      tickets.forEach(ticket => {
        activityLogs.push({
          ticketId: ticket.id,
          action: 'assigned',
          description: updates.assignedAgentId
            ? `Ticket assigned to agent (bulk update)`
            : `Ticket unassigned (bulk update)`,
          metadata: { to: updates.assignedAgentId, bulk: true },
        })
      })
    }

    if (updates.assignedTeamId !== undefined) {
      updateData.assignedTeamId = updates.assignedTeamId
      tickets.forEach(ticket => {
        activityLogs.push({
          ticketId: ticket.id,
          action: 'team_assigned',
          description: updates.assignedTeamId
            ? `Ticket assigned to team (bulk update)`
            : `Ticket unassigned from team (bulk update)`,
          metadata: { to: updates.assignedTeamId, bulk: true },
        })
      })
    }

    if (updates.categoryId !== undefined) {
      updateData.categoryId = updates.categoryId
    }

    // Update tickets
    const result = await prisma.ticket.updateMany({
      where: {
        id: { in: ticketIds },
      },
      data: updateData,
    })

    // Create activity logs
    if (activityLogs.length > 0) {
      await prisma.ticketActivity.createMany({
        data: activityLogs.map(log => ({
          ticketId: log.ticketId,
          userId: session.user.id,
          action: log.action,
          description: log.description,
          metadata: log.metadata || {},
        })),
      })
    }

    return NextResponse.json({
      success: true,
      updated: result.count,
      message: `Successfully updated ${result.count} ticket(s)`,
    })
  } catch (error: any) {
    console.error('Error bulk updating tickets:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to bulk update tickets' },
      { status: 500 }
    )
  }
}

/**
 * Bulk delete tickets (admin only)
 * Supports:
 * - Deleting specific tickets: ?ticketIds=id1,id2,id3
 * - Deleting all tickets: ?deleteAll=true&confirm=true
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

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

    const { searchParams } = new URL(req.url)
    const deleteAll = searchParams.get('deleteAll')
    const confirm = searchParams.get('confirm')
    const ticketIds = searchParams.get('ticketIds')

    // Handle delete all tickets
    if (deleteAll === 'true') {
      if (confirm !== 'true') {
        return NextResponse.json(
          { error: 'Deletion must be confirmed. Add ?deleteAll=true&confirm=true to the request.' },
          { status: 400 }
        )
      }

      // Count tickets before deletion
      const count = await prisma.ticket.count({
        where: { tenantId },
      })

      if (count === 0) {
        return NextResponse.json({
          success: true,
          message: 'No tickets to delete',
          deleted: 0,
        })
      }

      // Delete all tickets for this tenant (cascade will handle related records)
      const result = await prisma.ticket.deleteMany({
        where: { tenantId },
      })

      console.log(`[Bulk Delete] Deleted ${result.count} tickets by admin ${session.user.id}`)

      // Emit real-time update via WebSocket
      try {
        const { emitToAgents, emitToAdmins } = await import('@/lib/notifications/websocket')
        emitToAgents('tickets:bulk-deleted', { count: result.count })
        emitToAdmins('tickets:bulk-deleted', { count: result.count })
      } catch (error) {
        console.error('[Bulk Delete] ❌ Error emitting bulk deletion via WebSocket:', error)
      }

      return NextResponse.json({
        success: true,
        deleted: result.count,
        message: `Successfully deleted ${result.count} ticket(s)`,
      })
    }

    // Handle delete specific tickets
    if (!ticketIds) {
      return NextResponse.json(
        { error: 'Either ticketIds parameter or deleteAll=true is required' },
        { status: 400 }
      )
    }

    const ids = ticketIds.split(',').filter(id => id.trim())

    if (ids.length === 0) {
      return NextResponse.json(
        { error: 'At least one ticket ID is required' },
        { status: 400 }
      )
    }

    // Delete specific tickets (filtered by tenant for security)
    const result = await prisma.ticket.deleteMany({
      where: {
        id: { in: ids },
        tenantId, // Security: Only delete tickets from same tenant
      },
    })

    // Emit real-time update via WebSocket
    try {
      const { emitToAgents, emitToAdmins } = await import('@/lib/notifications/websocket')
      emitToAgents('tickets:bulk-deleted', { count: result.count, ticketIds: ids })
      emitToAdmins('tickets:bulk-deleted', { count: result.count, ticketIds: ids })
    } catch (error) {
      console.error('[Bulk Delete] ❌ Error emitting bulk deletion via WebSocket:', error)
    }

    return NextResponse.json({
      success: true,
      deleted: result.count,
      message: `Successfully deleted ${result.count} ticket(s)`,
    })
  } catch (error: any) {
    console.error('Error bulk deleting tickets:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to bulk delete tickets' },
      { status: 500 }
    )
  }
}

