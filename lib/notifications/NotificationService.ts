import { prisma } from '../prisma'
import { NotificationType } from '@prisma/client'
import { publishNotification } from './pubsub'
import { queueEmailNotification, queuePushNotification, queueFacebookNotification } from './queues'
import { getAppUrl } from '../utils'

export type DeliveryChannel = 'IN_APP' | 'EMAIL' | 'PUSH' | 'SMS' | 'FACEBOOK'

export interface NotificationParams {
  type: NotificationType
  title: string
  message: string
  userId: string
  ticketId?: string
  actorId?: string
  metadata?: Record<string, any>
  channels?: DeliveryChannel[]
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL'
}

export interface UserPreferences {
  inAppEnabled: boolean
  emailEnabled: boolean
  pushEnabled: boolean
  facebookEnabled: boolean
  emailDigest: 'REALTIME' | 'HOURLY' | 'DAILY' | 'WEEKLY'
  quietHoursEnabled: boolean
  quietHoursStart?: string
  quietHoursEnd?: string
}

export class NotificationService {
  /**
   * Create a new notification
   */
  async createNotification(params: NotificationParams) {
    try {
      // Create notification in database
      const notification = await prisma.notification.create({
        data: {
          type: params.type,
          title: params.title,
          message: params.message,
          userId: params.userId,
          ticketId: params.ticketId || null,
          actorId: params.actorId || null,
          metadata: params.metadata || {},
          read: false,
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
          ticket: {
            select: { id: true, ticketNumber: true, subject: true },
          },
        },
      })

      // Determine which channels to use
      const channels = params.channels || await this.determineChannels(params.userId, params.type)

      // Send to channels
      await this.sendToChannels(notification.id, channels, params)

      // Emit real-time notification via WebSocket
      try {
        await publishNotification(notification)
        console.log('[NotificationService] ✅ Published notification to Redis:', {
          notificationId: notification.id,
          userId: notification.userId,
          type: notification.type,
        })
      } catch (error) {
        console.error('[NotificationService] ❌ Error publishing notification to Redis:', error)
      }
      
      // Also emit directly via WebSocket if available (fallback)
      try {
        const { getIO } = await import('./websocket')
        const io = getIO()
        if (io) {
          io.to(`user:${notification.userId}`).emit('notification:new', notification)
          const unreadCount = await prisma.notification.count({
            where: { userId: notification.userId, read: false },
          })
          io.to(`user:${notification.userId}`).emit('notification:unread-count', unreadCount)
          console.log('[NotificationService] ✅ Emitted notification via WebSocket directly:', {
            notificationId: notification.id,
            userId: notification.userId,
          })
        }
      } catch (error) {
        console.error('[NotificationService] ⚠️ Could not emit via WebSocket directly:', error)
      }

      return notification
    } catch (error) {
      console.error('Error creating notification:', error)
      throw error
    }
  }

  /**
   * Determine which channels to use based on user preferences
   */
  private async determineChannels(userId: string, type: NotificationType): Promise<DeliveryChannel[]> {
    const channels: DeliveryChannel[] = ['IN_APP'] // Always include in-app

    // Get user preferences for this notification type
    const preference = await prisma.notificationPreference.findUnique({
      where: {
        userId_notificationType: {
          userId,
          notificationType: type,
        },
      },
    })

    // Use defaults if no preference exists
    if (!preference) {
      // Default: in-app + email for important notifications
      if (['TICKET_ASSIGNED', 'TICKET_REPLY', 'TICKET_STATUS_CHANGED'].includes(type)) {
        channels.push('EMAIL')
      }
      return channels
    }

    // Check if in quiet hours
    if (preference.quietHoursEnabled && this.isQuietHours(preference.quietHoursStart, preference.quietHoursEnd)) {
      // Only send critical notifications during quiet hours
      if (type !== 'SLA_BREACH' && type !== 'PRIORITY_ESCALATION') {
        return ['IN_APP'] // Only in-app during quiet hours
      }
    }

    // Add channels based on preferences
    if (preference.emailEnabled) {
      if (preference.emailDigest === 'REALTIME') {
        channels.push('EMAIL')
      } else {
        // Queue for digest
        await this.queueForDigest(userId, type, preference.emailDigest)
      }
    }

    if (preference.pushEnabled) {
      channels.push('PUSH')
    }

    if (preference.facebookEnabled && ['FACEBOOK_POST', 'FACEBOOK_COMMENT', 'FACEBOOK_MESSAGE'].includes(type)) {
      channels.push('FACEBOOK')
    }

    return channels
  }

  /**
   * Check if current time is within quiet hours
   */
  private isQuietHours(start?: string | null, end?: string | null): boolean {
    if (!start || !end) return false

    const now = new Date()
    const currentTime = now.getHours() * 60 + now.getMinutes()
    const [startHour, startMin] = start.split(':').map(Number)
    const [endHour, endMin] = end.split(':').map(Number)
    const startTime = startHour * 60 + startMin
    const endTime = endHour * 60 + endMin

    if (startTime <= endTime) {
      return currentTime >= startTime && currentTime <= endTime
    } else {
      // Overnight quiet hours
      return currentTime >= startTime || currentTime <= endTime
    }
  }

  /**
   * Queue notification for email digest
   */
  private async queueForDigest(userId: string, type: NotificationType, digest: string) {
    // This would be implemented with a scheduled job
    // For now, we'll just log it
    console.log(`Queuing notification for ${digest} digest: userId=${userId}, type=${type}`)
  }

  /**
   * Send notification to specified channels
   */
  async sendToChannels(
    notificationId: string,
    channels: DeliveryChannel[],
    params: NotificationParams
  ) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        user: {
          select: { id: true, email: true, name: true },
        },
      },
    })

    if (!notification) {
      throw new Error('Notification not found')
    }

    // Create delivery logs for each channel
    const deliveryLogs = await Promise.all(
      channels.map(channel =>
        prisma.notificationDeliveryLog.create({
          data: {
            notificationId,
            channel,
            status: 'PENDING',
            recipient: channel === 'EMAIL' ? notification.user.email : notification.userId,
          },
        })
      )
    )

    // Get tenantId from user or ticket
    let tenantId: string | undefined
    try {
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { tenantId: true },
      })
      tenantId = user?.tenantId || undefined
      
      // If we have a ticketId, prefer tenantId from ticket
      if (params.ticketId) {
        const ticket = await prisma.ticket.findUnique({
          where: { id: params.ticketId },
          select: { tenantId: true },
        })
        tenantId = ticket?.tenantId || tenantId
      }
    } catch (error) {
      console.warn('[NotificationService] Could not fetch tenantId:', error)
    }

    // Queue jobs for async processing
    for (const channel of channels) {
      try {
        switch (channel) {
          case 'EMAIL':
            // For ticket replies, add email threading and "Re: " prefix
            let emailSubject = params.title
            let inReplyTo: string | undefined
            let references: string | undefined

            if (params.type === 'TICKET_REPLY' && params.ticketId) {
              // Fetch ticket to get original email Message-ID and subject
              const ticket = await prisma.ticket.findUnique({
                where: { id: params.ticketId },
                select: { 
                  originalEmailMessageId: true, 
                  subject: true,
                  ticketNumber: true,
                  tenantId: true,
                },
              })
              
              // Use tenantId from ticket if available
              if (ticket?.tenantId) {
                tenantId = ticket.tenantId
              }

              if (ticket?.originalEmailMessageId) {
                // Use "Re: " prefix for replies - maintain thread subject
                // For better threading, we use the original email subject format
                // The original email subject is "Ticket Created Successfully - TKT-XXXX"
                // So replies should be "Re: Ticket Created Successfully - TKT-XXXX"
                // This ensures proper threading in email clients
                const originalEmailSubject = `Ticket Created Successfully - ${ticket.ticketNumber}`
                emailSubject = originalEmailSubject.startsWith('Re: ') 
                  ? originalEmailSubject 
                  : `Re: ${originalEmailSubject}`
                
                console.log(`[NotificationService] 📧 Setting up email threading:`, {
                  ticketId: params.ticketId,
                  originalMessageId: ticket.originalEmailMessageId,
                  subject: emailSubject,
                })
                
                // Build proper email threading chain
                // Get all previous email Message-IDs for this ticket from delivery logs
                const previousEmails = await prisma.notificationDeliveryLog.findMany({
                  where: {
                    notification: {
                      ticketId: params.ticketId,
                      type: 'TICKET_REPLY',
                    },
                    channel: 'EMAIL',
                    status: 'SENT',
                    messageId: { not: null },
                  },
                  select: { messageId: true },
                  orderBy: { sentAt: 'asc' },
                })

                // Build References chain: original + all previous replies
                const messageIds: string[] = [ticket.originalEmailMessageId]
                previousEmails.forEach(log => {
                  if (log.messageId && !messageIds.includes(log.messageId)) {
                    messageIds.push(log.messageId)
                  }
                })

                // Use the most recent Message-ID for In-Reply-To (or original if no previous replies)
                inReplyTo = messageIds[messageIds.length - 1]
                // References should include all Message-IDs in the thread
                references = messageIds.join(' ')
                
                console.log(`[NotificationService] 📧 Email threading headers:`, {
                  inReplyTo,
                  references: references.substring(0, 100) + (references.length > 100 ? '...' : ''),
                  messageIdCount: messageIds.length,
                })
              } else {
                console.warn(`[NotificationService] ⚠️ No originalEmailMessageId found for ticket ${params.ticketId} - email will not be threaded`)
              }
            }

            // Verify user has email before queuing
            if (!notification.user.email) {
              console.error(`[NotificationService] ❌ Cannot send email: User ${notification.user.id} has no email address`)
              await prisma.notificationDeliveryLog.updateMany({
                where: {
                  notificationId,
                  channel: 'EMAIL',
                },
                data: {
                  status: 'FAILED',
                  failedAt: new Date(),
                  errorMessage: 'User has no email address',
                },
              })
              break
            }

            console.log(`[NotificationService] 📧 Queuing email notification:`, {
              notificationId,
              to: notification.user.email,
              subject: emailSubject,
              type: params.type,
              ticketId: params.ticketId,
            })

            try {
              // Get metadata from params or notification (notification metadata is stored as JSON)
              const metadata = params.metadata || (notification.metadata as any) || {}
              
              // For TICKET_REPLY, use plain text instead of HTML
              if (params.type === 'TICKET_REPLY' && metadata.replyContent) {
                console.log('[NotificationService] 📧 Sending plain text reply email:', {
                  notificationId,
                  to: notification.user.email,
                  replyContentLength: metadata.replyContent?.length || 0,
                  replyContentPreview: metadata.replyContent?.substring(0, 50) || 'missing',
                })
                await queueEmailNotification({
                  notificationId,
                  to: notification.user.email,
                  subject: emailSubject,
                  text: metadata.replyContent, // Plain text reply
                  type: params.type,
                  userId: params.userId,
                  tenantId,
                  inReplyTo,
                  references,
                })
              } else {
                const emailHtml = await this.renderEmailTemplate(params.type, { ...params, metadata })
                await queueEmailNotification({
                  notificationId,
                  to: notification.user.email,
                  subject: emailSubject,
                  html: emailHtml,
                  type: params.type,
                  userId: params.userId,
                  tenantId,
                  inReplyTo,
                  references,
                })
              }
              console.log(`[NotificationService] ✅ Email queued successfully:`, {
                notificationId,
                to: notification.user.email,
                subject: emailSubject.substring(0, 50),
              })
            } catch (queueError: any) {
              console.error(`[NotificationService] ❌ Failed to queue email, attempting direct send:`, {
                notificationId,
                to: notification.user.email,
                queueError: queueError.message,
              })
              
              // Fallback: Try to send email directly if queue fails
              try {
                const { sendEmail } = await import('../email')
                let result: any
                
                // Get metadata from params or notification (notification metadata is stored as JSON)
                const metadata = params.metadata || (notification.metadata as any) || {}
                
                // For TICKET_REPLY, use plain text instead of HTML
                if (params.type === 'TICKET_REPLY' && metadata.replyContent) {
                  console.log('[NotificationService] 📧 Sending plain text reply email (fallback):', {
                    notificationId,
                    to: notification.user.email,
                    replyContentLength: metadata.replyContent?.length || 0,
                  })
                  result = await sendEmail({
                    to: notification.user.email,
                    subject: emailSubject,
                    text: metadata.replyContent, // Plain text reply
                    inReplyTo,
                    references,
                    tenantId,
                  })
                } else {
                  const emailHtml = await this.renderEmailTemplate(params.type, { ...params, metadata })
                  result = await sendEmail({
                    to: notification.user.email,
                    subject: emailSubject,
                    html: emailHtml,
                    inReplyTo,
                    references,
                    tenantId,
                  })
                }
                
                // Update delivery log
                await prisma.notificationDeliveryLog.updateMany({
                  where: {
                    notificationId,
                    channel: 'EMAIL',
                  },
                  data: {
                    status: 'SENT',
                    sentAt: new Date(),
                    messageId: result?.messageId || undefined,
                  },
                })
                
                console.log(`[NotificationService] ✅ Email sent directly (fallback):`, {
                  notificationId,
                  to: notification.user.email,
                  messageId: (result as any).messageId,
                })
              } catch (directSendError: any) {
                console.error(`[NotificationService] ❌ Direct email send also failed:`, {
                  notificationId,
                  to: notification.user.email,
                  error: directSendError.message,
                })
                // Update delivery log to failed
                await prisma.notificationDeliveryLog.updateMany({
                  where: {
                    notificationId,
                    channel: 'EMAIL',
                  },
                  data: {
                    status: 'FAILED',
                    failedAt: new Date(),
                    errorMessage: `Queue error: ${queueError.message}, Direct send error: ${directSendError.message}`,
                  },
                })
              }
            }
            break

          case 'PUSH':
            await queuePushNotification({
              notificationId,
              userId: params.userId,
              title: params.title,
              body: params.message,
              url: params.ticketId ? `/agent/tickets/${params.ticketId}` : undefined,
            })
            break

          case 'FACEBOOK':
            if (params.metadata?.facebookData) {
              await queueFacebookNotification({
                notificationId,
                type: params.type,
                data: params.metadata.facebookData,
              })
            }
            break

          case 'IN_APP':
            // In-app notifications are handled via WebSocket (already sent in createNotification)
            await prisma.notificationDeliveryLog.updateMany({
              where: {
                notificationId,
                channel: 'IN_APP',
              },
              data: {
                status: 'SENT',
                sentAt: new Date(),
              },
            })
            break
        }
      } catch (error) {
        console.error(`Error queuing ${channel} notification:`, error)
        // Update delivery log to failed
        await prisma.notificationDeliveryLog.updateMany({
          where: {
            notificationId,
            channel,
          },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        })
      }
    }
  }

  /**
   * Render email template
   */
  private async renderEmailTemplate(type: NotificationType, params: NotificationParams): Promise<string> {
    // Try to get custom template
    try {
      const template = await prisma.notificationTemplate.findFirst({
        where: {
          type,
          channel: 'EMAIL',
          isActive: true,
        },
      })

      if (template && template.htmlTemplate) {
        // Render template with variables
        let html = template.htmlTemplate
        const appUrl = getAppUrl()
        
        // Determine ticket URL based on notification type
        // For TICKET_REPLY to customers, use public ticket URL
        let ticketUrl = ''
        if (params.ticketId) {
          if (params.type === 'TICKET_REPLY' && params.metadata?.agentName) {
            // Agent reply to customer - use public ticket URL
            ticketUrl = `${appUrl}/tickets/${params.ticketId}`
          } else {
            // Other notifications - use agent URL
            ticketUrl = `${appUrl}/agent/tickets/${params.ticketId}`
          }
        }
        
        const variables = {
          TITLE: params.title,
          MESSAGE: params.message,
          USER_NAME: params.metadata?.userName || params.metadata?.customerName || 'User',
          TICKET_NUMBER: params.metadata?.ticketNumber || '',
          TICKET_SUBJECT: params.metadata?.ticketSubject || '',
          TICKET_URL: ticketUrl,
          REPLY_CONTENT: params.metadata?.replyContent || params.metadata?.replyPreview || '',
          AGENT_NAME: params.metadata?.agentName || 'Support Agent',
          AGENT_EMAIL: params.metadata?.agentEmail || '',
          ...params.metadata,
        }

        Object.entries(variables).forEach(([key, value]) => {
          html = html.replace(new RegExp(`{{${key}}}`, 'g'), String(value || ''))
        })

        return html
      }
    } catch (error) {
      console.error('Error loading email template:', error)
    }

    // Fallback to simple HTML
    const appUrl = getAppUrl()
    
    // Determine ticket URL based on notification type
    let ticketUrl = ''
    if (params.ticketId) {
      if (params.type === 'TICKET_REPLY' && params.metadata?.agentName) {
        // Agent reply to customer - use public ticket URL
        ticketUrl = `${appUrl}/tickets/${params.ticketId}`
      } else {
        // Other notifications - use agent URL
        ticketUrl = `${appUrl}/agent/tickets/${params.ticketId}`
      }
    }
    
    // For ticket replies, return empty string to indicate plain text should be used
    if (params.type === 'TICKET_REPLY' && params.metadata?.replyContent) {
      return '' // Signal to use plain text instead
    }
    
    return `
      <h2>${params.title}</h2>
      <p>${params.message}</p>
      ${ticketUrl ? `<p><a href="${ticketUrl}">View Ticket</a></p>` : ''}
    `
  }

  /**
   * Get user notification preferences
   */
  async getUserPreferences(userId: string): Promise<UserPreferences[]> {
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId },
    })

    return preferences.map(p => ({
      inAppEnabled: p.inAppEnabled,
      emailEnabled: p.emailEnabled,
      pushEnabled: p.pushEnabled,
      facebookEnabled: p.facebookEnabled,
      emailDigest: p.emailDigest,
      quietHoursEnabled: p.quietHoursEnabled,
      quietHoursStart: p.quietHoursStart || undefined,
      quietHoursEnd: p.quietHoursEnd || undefined,
    }))
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    })

    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found or unauthorized')
    }

    return await prisma.notification.update({
      where: { id: notificationId },
      data: {
        read: true,
        readAt: new Date(),
      },
    })
  }

  /**
   * Mark all notifications as read for user
   */
  async markAllAsRead(userId: string, storeId?: string | null) {
    // Get user role to determine if we should filter by store
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })

    const where: any = {
      userId,
      read: false,
    }

    // Filter by storeId through ticket relation (for ADMIN and AGENT roles)
    // Customers see all their notifications regardless of store
    if (storeId && user?.role !== 'CUSTOMER') {
      where.ticket = {
        storeId: storeId,
      }
    }

    const result = await prisma.notification.updateMany({
      where,
      data: {
        read: true,
        readAt: new Date(),
      },
    })

    return result.count
  }

  /**
   * Get unread notification count for user
   */
  async getUnreadCount(userId: string, storeId?: string | null): Promise<number> {
    try {
      if (!userId || typeof userId !== 'string') {
        throw new Error('Invalid userId provided for getUnreadCount')
      }

      // Get user's creation date to filter out notifications created before account creation
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { createdAt: true, role: true },
      })

      const where: any = {
        userId,
        read: false,
      }

      // Only count notifications created after user's account was created
      if (user?.createdAt) {
        where.createdAt = {
          gte: user.createdAt,
        }
      }

      // Filter by storeId through ticket relation (for ADMIN and AGENT roles)
      // Customers see all their notifications regardless of store
      if (storeId && user?.role !== 'CUSTOMER') {
        where.ticket = {
          storeId: storeId,
        }
      }

      const count = await prisma.notification.count({ where })
      return count
    } catch (error) {
      console.error('Error getting unread count:', error)
      throw error
    }
  }

  /**
   * Get notifications for user
   */
  async getNotifications(
    userId: string,
    options: {
      page?: number
      limit?: number
      read?: boolean
      type?: NotificationType
      storeId?: string | null
    } = {}
  ) {
    const page = options.page || 1
    const limit = options.limit || 20
    const skip = (page - 1) * limit

    // Get user's creation date to filter out notifications created before account creation
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, role: true },
    })

    const where: any = {
      userId,
    }

    // Only show notifications created after user's account was created
    if (user?.createdAt) {
      where.createdAt = {
        gte: user.createdAt,
      }
    }

    if (options.read !== undefined) {
      where.read = options.read
    }

    if (options.type) {
      where.type = options.type
    }

    // Filter by storeId through ticket relation (for ADMIN and AGENT roles)
    // Customers see all their notifications regardless of store
    if (options.storeId && user?.role !== 'CUSTOMER') {
      where.ticket = {
        storeId: options.storeId,
      }
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: {
          ticket: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true,
            },
          },
          actor: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          facebookNotification: {
            select: {
              id: true,
              postUrl: true,
              type: true,
              facebookPostId: true,
              converted: true,
              convertedTicketId: true,
              convertedTicket: {
                select: {
                  id: true,
                  ticketNumber: true,
                  status: true,
                  priority: true,
                },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          ...where,
          read: false,
        },
      }),
    ])

    // Enhance notifications with converted ticket info from metadata
    const enhancedNotifications = notifications.map(notification => {
      const metadata = notification.metadata as any || {}
      
      // If Facebook notification is converted, add ticket info to metadata
      if (notification.facebookNotification?.converted && notification.facebookNotification?.convertedTicket) {
        const ticket = notification.facebookNotification.convertedTicket
        return {
          ...notification,
          metadata: {
            ...metadata,
            converted: true,
            convertedTicketId: ticket.id,
            convertedTicketNumber: ticket.ticketNumber,
            convertedTicketStatus: ticket.status,
          },
        }
      }
      
      return notification
    })

    return {
      notifications: enhancedNotifications,
      total,
      unreadCount,
      page,
      totalPages: Math.ceil(total / limit),
    }
  }

  /**
   * Delete notification
   * Only ADMIN users can delete notifications
   */
  async deleteNotification(notificationId: string, userId: string) {
    // Check if user is ADMIN
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })

    if (!user || user.role !== 'ADMIN') {
      throw new Error('Only administrators can delete notifications')
    }

    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    })

    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found or unauthorized')
    }

    return await prisma.notification.delete({
      where: { id: notificationId },
    })
  }
}

// Export singleton instance
export const notificationService = new NotificationService()

