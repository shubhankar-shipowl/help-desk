import { notificationService } from '../NotificationService'
import { prisma } from '../../prisma'
import { NotificationType } from '@prisma/client'
import { getAppUrl } from '../../utils'

export class TicketNotificationTriggers {
  /**
   * Trigger when new ticket is created
   */
  async onTicketCreated(ticket: any) {
    // Notify customer (confirmation)
    await notificationService.createNotification({
      type: 'TICKET_UPDATED',
      title: 'Ticket Created Successfully',
      message: `Your ticket ${ticket.ticketNumber} has been created and will be reviewed soon`,
      userId: ticket.customerId,
      ticketId: ticket.id,
      actorId: ticket.customerId,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        ticketSubject: ticket.subject,
        ticketPriority: ticket.priority,
        ticketCategory: ticket.category?.name || 'General',
      },
      channels: ['IN_APP'], // Email already sent separately
    })

    // Notify all admins about the new ticket
    const admins = await prisma.user.findMany({
      where: {
        role: 'ADMIN',
        isActive: true,
      },
    })

    for (const admin of admins) {
      await notificationService.createNotification({
        type: 'TICKET_UPDATED',
        title: 'New Ticket Created',
        message: `New ${ticket.priority} priority ticket ${ticket.ticketNumber} has been created${ticket.assignedAgentId ? ` and assigned to ${ticket.assignedAgent?.name || 'an agent'}` : ''}`,
        userId: admin.id,
        ticketId: ticket.id,
        actorId: ticket.customerId,
        metadata: {
          ticketNumber: ticket.ticketNumber,
          ticketSubject: ticket.subject,
          ticketPriority: ticket.priority,
          ticketCategory: ticket.category?.name || 'General',
          customerName: ticket.customer?.name || ticket.customer?.email,
          assignedAgentName: ticket.assignedAgent?.name || null,
        },
        channels: ['IN_APP', 'EMAIL'],
      })
    }

    // Don't notify assigned agent here - onTicketAssigned will handle it
    // This prevents duplicate notifications when ticket is created and immediately assigned
  }

  /**
   * Trigger when ticket is assigned
   */
  async onTicketAssigned(ticket: any, assignedBy?: any) {
    if (!ticket.assignedAgentId) return

    // Notify assigned agent
    await notificationService.createNotification({
      type: 'TICKET_ASSIGNED',
      title: 'Ticket Assigned to You',
      message: `Ticket ${ticket.ticketNumber} has been assigned to you`,
      userId: ticket.assignedAgentId,
      ticketId: ticket.id,
      actorId: assignedBy?.id || null,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        ticketSubject: ticket.subject,
        ticketPriority: ticket.priority,
        assignedBy: assignedBy?.name || 'System',
      },
      channels: ['IN_APP', 'EMAIL', 'PUSH'],
    })

    // Customer notification removed - customers will not receive email when ticket is assigned
    // They will only be notified when agents reply to their tickets
  }

  /**
   * Trigger when new reply is added
   */
  async onNewReply(comment: any, ticket: any) {
    if (comment.isInternal) {
      // Internal note - check for mentions
      const mentions = this.extractMentions(comment.content)

      for (const mentionedUserId of mentions) {
        await notificationService.createNotification({
          type: 'TICKET_MENTION',
          title: 'You were mentioned',
          message: `${comment.author?.name || comment.author?.email} mentioned you in ticket ${ticket.ticketNumber}`,
          userId: mentionedUserId,
          ticketId: ticket.id,
          actorId: comment.authorId,
          metadata: {
            ticketNumber: ticket.ticketNumber,
            commentPreview: comment.content.substring(0, 100),
          },
          channels: ['IN_APP', 'EMAIL'],
        })
      }
    } else {
      // Public reply
      if (comment.author.role === 'CUSTOMER') {
        // Customer replied - notify assigned agent
        if (ticket.assignedAgentId) {
          await notificationService.createNotification({
            type: 'TICKET_REPLY',
            title: 'New Customer Reply',
            message: `${comment.author?.name || comment.author?.email} replied to ticket ${ticket.ticketNumber}`,
            userId: ticket.assignedAgentId,
            ticketId: ticket.id,
            actorId: comment.authorId,
            metadata: {
              ticketNumber: ticket.ticketNumber,
              replyPreview: comment.content.substring(0, 100),
            },
            channels: ['IN_APP', 'EMAIL', 'PUSH'],
          })
        }
      } else {
        // Agent replied - notify customer with full reply content
        console.log('[TicketTriggers] Agent reply - notifying customer:', {
          customerId: ticket.customerId,
          customerEmail: ticket.customer?.email,
          replyContent: comment.content?.substring(0, 50),
        })

        // Verify customer has email before creating notification
        if (!ticket.customer?.email) {
          console.error('[TicketTriggers] ❌ Cannot notify customer: No email address found', {
            customerId: ticket.customerId,
            customer: ticket.customer,
          })
          return
        }

        await notificationService.createNotification({
          type: 'TICKET_REPLY',
          title: 'New Reply on Your Ticket',
          message: `${comment.author?.name || 'An agent'} replied to your ticket ${ticket.ticketNumber}`,
          userId: ticket.customerId,
          ticketId: ticket.id,
          actorId: comment.authorId,
          metadata: {
            ticketNumber: ticket.ticketNumber,
            ticketSubject: ticket.subject,
            replyContent: comment.content, // Full reply content for email
            replyPreview: comment.content.substring(0, 100),
            agentName: comment.author?.name || 'Support Agent',
            agentEmail: comment.author?.email || '',
          },
          channels: ['IN_APP', 'EMAIL'],
        })
      }
    }
  }

  /**
   * Trigger when ticket status changes
   */
  async onStatusChanged(ticket: any, oldStatus: string, changedBy: any) {
    // Notify customer (in-app only, no email)
    await notificationService.createNotification({
      type: 'TICKET_STATUS_CHANGED',
      title: 'Ticket Status Updated',
      message: `Your ticket ${ticket.ticketNumber} status changed from ${oldStatus} to ${ticket.status}`,
      userId: ticket.customerId,
      ticketId: ticket.id,
      actorId: changedBy?.id || null,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        oldStatus,
        newStatus: ticket.status,
      },
      channels: ['IN_APP'], // Only in-app notification, no email
    })

    // If an agent changed the status, notify all admins
    if (changedBy && changedBy.role === 'AGENT') {
      const admins = await prisma.user.findMany({
        where: {
          role: 'ADMIN',
          isActive: true,
        },
      })

      for (const admin of admins) {
        await notificationService.createNotification({
          type: 'TICKET_STATUS_CHANGED',
          title: 'Ticket Status Changed by Agent',
          message: `${changedBy.name || changedBy.email} changed ticket ${ticket.ticketNumber} status from ${oldStatus} to ${ticket.status}`,
          userId: admin.id,
          ticketId: ticket.id,
          actorId: changedBy.id,
          metadata: {
            ticketNumber: ticket.ticketNumber,
            ticketSubject: ticket.subject,
            oldStatus,
            newStatus: ticket.status,
            changedBy: changedBy.name || changedBy.email,
            agentName: changedBy.name || 'Agent',
          },
          channels: ['IN_APP'], // Only in-app notification, no email
        })
      }
    }

    // If resolved, trigger satisfaction survey
    if (ticket.status === 'RESOLVED') {
      await this.onTicketResolved(ticket, changedBy)
    }
  }

  /**
   * Trigger when ticket is resolved
   */
  async onTicketResolved(ticket: any, resolvedBy: any) {
    const resolutionTime = this.calculateResolutionTime(ticket)

    await notificationService.createNotification({
      type: 'TICKET_STATUS_CHANGED',
      title: 'Your Ticket Has Been Resolved',
      message: `Your ticket ${ticket.ticketNumber} has been marked as resolved. How was your experience?`,
      userId: ticket.customerId,
      ticketId: ticket.id,
      actorId: resolvedBy?.id || null,
      metadata: {
        ticketNumber: ticket.ticketNumber,
        resolutionTime,
        agentName: ticket.assignedAgent?.name || 'Support Team',
        csatSurveyUrl: `${getAppUrl()}/tickets/${ticket.id}/rate`,
      },
      channels: ['IN_APP'], // Only in-app notification, no email
    })
  }

  /**
   * Extract user mentions from content
   */
  private extractMentions(content: string): string[] {
    // Pattern: @[Name](userId) or @userId
    const mentionRegex = /@\[([^\]]+)\]\(([^)]+)\)|@(\w+)/g
    const mentions: string[] = []
    let match

    while ((match = mentionRegex.exec(content)) !== null) {
      const userId = match[2] || match[3]
      if (userId) {
        mentions.push(userId)
      }
    }

    return mentions
  }

  /**
   * Calculate resolution time
   */
  private calculateResolutionTime(ticket: any): string {
    if (!ticket.resolvedAt || !ticket.createdAt) {
      return 'N/A'
    }

    const created = new Date(ticket.createdAt)
    const resolved = new Date(ticket.resolvedAt)
    const hours = Math.floor((resolved.getTime() - created.getTime()) / (1000 * 60 * 60))

    if (hours < 1) return 'less than 1 hour'
    if (hours === 1) return '1 hour'
    if (hours < 24) return `${hours} hours`

    const days = Math.floor(hours / 24)
    return `${days} day${days > 1 ? 's' : ''}`
  }
}

export const ticketNotificationTriggers = new TicketNotificationTriggers()

