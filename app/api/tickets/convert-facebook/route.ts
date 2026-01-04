import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { convertFacebookNotificationToTicket } from '@/lib/tickets/facebookConverter'
import { prisma } from '@/lib/prisma'
import { notificationService } from '@/lib/notifications/NotificationService'
import { NotificationType } from '@prisma/client'

export const dynamic = 'force-dynamic'

/**
 * Convert Facebook notification to ticket
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { 
      facebookNotificationId, 
      assignedAgentId, 
      assignedTeamId, 
      priority, 
      categoryId,
      tags 
    } = body

    if (!facebookNotificationId) {
      return NextResponse.json(
        { error: 'facebookNotificationId is required' },
        { status: 400 }
      )
    }

    // Check if notification exists and is not already converted
    const fbNotification = await prisma.facebookNotification.findUnique({
      where: { id: facebookNotificationId },
      include: {
        notification: true,
      },
    })

    if (!fbNotification) {
      return NextResponse.json(
        { error: 'Facebook notification not found' },
        { status: 404 }
      )
    }

    if (fbNotification.converted) {
      return NextResponse.json(
        { error: 'Notification already converted to ticket', ticketId: fbNotification.convertedTicketId },
        { status: 400 }
      )
    }

    // Convert to ticket
    const ticket = await convertFacebookNotificationToTicket(facebookNotificationId, {
      assignedAgentId,
      assignedTeamId,
      priority,
      categoryId,
      tags,
    })

    // Update the original Facebook notification's metadata to include ticket info
    // This allows the notification to show the converted status and ticket status
    await prisma.notification.update({
      where: { id: fbNotification.notificationId },
      data: {
        metadata: {
          ...(fbNotification.notification.metadata as any || {}),
          converted: true,
          convertedTicketId: ticket.id,
          convertedTicketNumber: ticket.ticketNumber,
          convertedTicketStatus: ticket.status,
        },
      },
    })

    // Only notify assigned agent if they weren't the one who converted it
    if (ticket.assignedAgentId && ticket.assignedAgentId !== session.user.id) {
      await notificationService.createNotification({
        type: NotificationType.TICKET_ASSIGNED,
        title: 'New Ticket Assigned',
        message: `Ticket ${ticket.ticketNumber} has been assigned to you`,
        userId: ticket.assignedAgentId,
        ticketId: ticket.id,
        metadata: {
          ticketNumber: ticket.ticketNumber,
          subject: ticket.subject,
          source: 'FACEBOOK',
        },
      })
    }

    return NextResponse.json({
      success: true,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        source: ticket.source,
      },
    })
  } catch (error: any) {
    console.error('Error converting Facebook notification to ticket:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to convert notification to ticket' },
      { status: 500 }
    )
  }
}

/**
 * Get conversion status of Facebook notification
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const facebookNotificationId = searchParams.get('facebookNotificationId')

    if (!facebookNotificationId) {
      return NextResponse.json(
        { error: 'facebookNotificationId is required' },
        { status: 400 }
      )
    }

    const fbNotification = await prisma.facebookNotification.findUnique({
      where: { id: facebookNotificationId },
      include: {
        convertedTicket: {
          select: {
            id: true,
            ticketNumber: true,
            subject: true,
            status: true,
            priority: true,
          },
        },
      },
    })

    if (!fbNotification) {
      return NextResponse.json(
        { error: 'Facebook notification not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      converted: fbNotification.converted,
      ticket: fbNotification.convertedTicket,
    })
  } catch (error: any) {
    console.error('Error checking conversion status:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to check conversion status' },
      { status: 500 }
    )
  }
}

