import { prisma } from '../config/database'

// Define locally to avoid build failures when @prisma/client types are not yet generated
type Notification_type =
  | 'TICKET_ASSIGNED' | 'TICKET_UPDATED' | 'TICKET_REPLY'
  | 'TICKET_STATUS_CHANGED' | 'TICKET_MENTION'
  | 'SLA_BREACH' | 'PRIORITY_ESCALATION'
  | 'FACEBOOK_MESSAGE' | 'FACEBOOK_COMMENT' | 'FACEBOOK_POST'
import { publishNotification } from './pubsub'
import { queueEmailNotification, queuePushNotification, queueFacebookNotification } from './queues'
import { getIO } from './websocket'
import crypto from 'crypto'

const APP_URL = process.env.APP_URL || 'http://localhost:4002'

export type DeliveryChannel = 'IN_APP' | 'EMAIL' | 'PUSH' | 'SMS' | 'FACEBOOK'

export interface NotificationParams {
  type: Notification_type
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
  async createNotification(params: NotificationParams) {
    try {
      const now = new Date()
      const notification = await prisma.notification.create({
        data: {
          id: crypto.randomUUID(),
          type: params.type,
          title: params.title,
          message: params.message,
          userId: params.userId,
          ticketId: params.ticketId || null,
          actorId: params.actorId || null,
          metadata: params.metadata || {},
          read: false,
          updatedAt: now,
        },
        include: {
          User_Notification_userIdToUser: {
            select: { id: true, name: true, email: true },
          },
          Ticket: {
            select: { id: true, ticketNumber: true, subject: true },
          },
        },
      })

      const channels = params.channels || await this.determineChannels(params.userId, params.type)
      await this.sendToChannels(notification.id, channels, params)

      // Publish to Redis for WebSocket delivery
      try {
        await publishNotification(notification)
      } catch (error) {
        console.error('[NotificationService] Error publishing notification to Redis:', error)
      }

      // Also emit directly via WebSocket (fallback)
      try {
        const io = getIO()
        if (io) {
          io.to(`user:${notification.userId}`).emit('notification:new', notification)
          const unreadCount = await prisma.notification.count({
            where: { userId: notification.userId, read: false },
          })
          io.to(`user:${notification.userId}`).emit('notification:unread-count', unreadCount)
        }
      } catch (error) {
        console.error('[NotificationService] Could not emit via WebSocket directly:', error)
      }

      return notification
    } catch (error) {
      console.error('Error creating notification:', error)
      throw error
    }
  }

  private async determineChannels(userId: string, type: Notification_type): Promise<DeliveryChannel[]> {
    const channels: DeliveryChannel[] = ['IN_APP']

    const preference = await prisma.notificationPreference.findUnique({
      where: {
        userId_notificationType: {
          userId,
          notificationType: type,
        },
      },
    })

    if (!preference) {
      if (['TICKET_ASSIGNED', 'TICKET_REPLY', 'TICKET_STATUS_CHANGED'].includes(type)) {
        channels.push('EMAIL')
      }
      return channels
    }

    if (preference.quietHoursEnabled && this.isQuietHours(preference.quietHoursStart, preference.quietHoursEnd)) {
      if (type !== 'SLA_BREACH' && type !== 'PRIORITY_ESCALATION') {
        return ['IN_APP']
      }
    }

    if (preference.emailEnabled) {
      if (preference.emailDigest === 'REALTIME') {
        channels.push('EMAIL')
      } else {
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
      return currentTime >= startTime || currentTime <= endTime
    }
  }

  private async queueForDigest(userId: string, type: Notification_type, digest: string) {
    console.log(`Queuing notification for ${digest} digest: userId=${userId}, type=${type}`)
  }

  async sendToChannels(
    notificationId: string,
    channels: DeliveryChannel[],
    params: NotificationParams
  ) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
      include: {
        User_Notification_userIdToUser: {
          select: { id: true, email: true, name: true },
        },
      },
    })

    if (!notification) {
      throw new Error('Notification not found')
    }

    await Promise.all(
      channels.map(channel =>
        prisma.notificationDeliveryLog.create({
          data: {
            id: crypto.randomUUID(),
            notificationId,
            channel,
            status: 'PENDING',
            recipient: channel === 'EMAIL' ? notification.User_Notification_userIdToUser.email : notification.userId,
          },
        })
      )
    )

    let tenantId: string | undefined
    let storeId: string | null | undefined
    try {
      const user = await prisma.user.findUnique({
        where: { id: params.userId },
        select: { tenantId: true, storeId: true },
      })
      tenantId = user?.tenantId || undefined
      storeId = user?.storeId || undefined

      if (params.ticketId) {
        const ticket = await prisma.ticket.findUnique({
          where: { id: params.ticketId },
          select: { tenantId: true, storeId: true },
        })
        tenantId = ticket?.tenantId || tenantId
        storeId = ticket?.storeId || storeId
      }
    } catch (error) {
      console.warn('[NotificationService] Could not fetch tenantId/storeId:', error)
    }

    for (const channel of channels) {
      try {
        switch (channel) {
          case 'EMAIL':
            let emailSubject = params.title
            let inReplyTo: string | undefined
            let references: string | undefined

            if (params.type === 'TICKET_REPLY' && params.ticketId) {
              const ticket = await prisma.ticket.findUnique({
                where: { id: params.ticketId },
                select: {
                  originalEmailMessageId: true,
                  subject: true,
                  ticketNumber: true,
                  tenantId: true,
                },
              })

              if (ticket?.tenantId) {
                tenantId = ticket.tenantId
              }

              if (ticket?.originalEmailMessageId) {
                const originalEmailSubject = `Ticket Created Successfully - ${ticket.ticketNumber}`
                emailSubject = originalEmailSubject.startsWith('Re: ')
                  ? originalEmailSubject
                  : `Re: ${originalEmailSubject}`

                const previousEmails = await prisma.notificationDeliveryLog.findMany({
                  where: {
                    Notification: {
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

                const messageIds: string[] = [ticket.originalEmailMessageId]
                previousEmails.forEach((log: any) => {
                  if (log.messageId && !messageIds.includes(log.messageId)) {
                    messageIds.push(log.messageId)
                  }
                })

                inReplyTo = messageIds[messageIds.length - 1]
                references = messageIds.join(' ')
              }
            }

            if (!notification.User_Notification_userIdToUser.email) {
              await prisma.notificationDeliveryLog.updateMany({
                where: { notificationId, channel: 'EMAIL' },
                data: {
                  status: 'FAILED',
                  failedAt: new Date(),
                  errorMessage: 'User has no email address',
                },
              })
              break
            }

            try {
              const metadata = params.metadata || (notification.metadata as any) || {}

              if (params.type === 'TICKET_REPLY' && metadata.replyContent) {
                await queueEmailNotification({
                  notificationId,
                  to: notification.User_Notification_userIdToUser.email,
                  subject: emailSubject,
                  text: metadata.replyContent,
                  type: params.type,
                  userId: params.userId,
                  tenantId,
                  storeId,
                  inReplyTo,
                  references,
                })
              } else {
                const emailHtml = await this.renderEmailTemplate(params.type, { ...params, metadata })
                await queueEmailNotification({
                  notificationId,
                  to: notification.User_Notification_userIdToUser.email,
                  subject: emailSubject,
                  html: emailHtml,
                  type: params.type,
                  userId: params.userId,
                  tenantId,
                  storeId,
                  inReplyTo,
                  references,
                })
              }
            } catch (queueError: any) {
              console.error(`[NotificationService] Failed to queue email, attempting direct send:`, queueError.message)

              try {
                const { sendEmail } = await import('./email-sender')
                const metadata = params.metadata || (notification.metadata as any) || {}
                let result: any

                if (params.type === 'TICKET_REPLY' && metadata.replyContent) {
                  result = await sendEmail({
                    to: notification.User_Notification_userIdToUser.email,
                    subject: emailSubject,
                    text: metadata.replyContent,
                    inReplyTo,
                    references,
                    tenantId,
                  })
                } else {
                  const emailHtml = await this.renderEmailTemplate(params.type, { ...params, metadata })
                  result = await sendEmail({
                    to: notification.User_Notification_userIdToUser.email,
                    subject: emailSubject,
                    html: emailHtml,
                    inReplyTo,
                    references,
                    tenantId,
                  })
                }

                await prisma.notificationDeliveryLog.updateMany({
                  where: { notificationId, channel: 'EMAIL' },
                  data: {
                    status: 'SENT',
                    sentAt: new Date(),
                    messageId: result?.messageId || undefined,
                  },
                })
              } catch (directSendError: any) {
                await prisma.notificationDeliveryLog.updateMany({
                  where: { notificationId, channel: 'EMAIL' },
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
            await prisma.notificationDeliveryLog.updateMany({
              where: { notificationId, channel: 'IN_APP' },
              data: { status: 'SENT', sentAt: new Date() },
            })
            break
        }
      } catch (error) {
        console.error(`Error queuing ${channel} notification:`, error)
        await prisma.notificationDeliveryLog.updateMany({
          where: { notificationId, channel },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorMessage: error instanceof Error ? error.message : 'Unknown error',
          },
        })
      }
    }
  }

  private async renderEmailTemplate(type: Notification_type, params: NotificationParams): Promise<string> {
    try {
      const template = await prisma.notificationTemplate.findFirst({
        where: { type, channel: 'EMAIL', isActive: true },
      })

      if (template && template.htmlTemplate) {
        let html = template.htmlTemplate

        let ticketUrl = ''
        if (params.ticketId) {
          if (params.type === 'TICKET_REPLY' && params.metadata?.agentName) {
            ticketUrl = `${APP_URL}/tickets/${params.ticketId}`
          } else {
            ticketUrl = `${APP_URL}/agent/tickets/${params.ticketId}`
          }
        }

        const variables: Record<string, string> = {
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

    let ticketUrl = ''
    if (params.ticketId) {
      if (params.type === 'TICKET_REPLY' && params.metadata?.agentName) {
        ticketUrl = `${APP_URL}/tickets/${params.ticketId}`
      } else {
        ticketUrl = `${APP_URL}/agent/tickets/${params.ticketId}`
      }
    }

    if (params.type === 'TICKET_REPLY' && params.metadata?.replyContent) {
      return ''
    }

    return `
      <h2>${params.title}</h2>
      <p>${params.message}</p>
      ${ticketUrl ? `<p><a href="${ticketUrl}">View Ticket</a></p>` : ''}
    `
  }

  async getUserPreferences(userId: string): Promise<UserPreferences[]> {
    const preferences = await prisma.notificationPreference.findMany({
      where: { userId },
    })

    return preferences.map((p: any) => ({
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

  async markAsRead(notificationId: string, userId: string) {
    const notification = await prisma.notification.findUnique({
      where: { id: notificationId },
    })

    if (!notification || notification.userId !== userId) {
      throw new Error('Notification not found or unauthorized')
    }

    return await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true, readAt: new Date() },
    })
  }

  async markAllAsRead(userId: string, storeId?: string | null) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    })

    const where: any = { userId, read: false }

    if (storeId && user?.role !== 'CUSTOMER') {
      where.ticket = { storeId }
    }

    const result = await prisma.notification.updateMany({
      where,
      data: { read: true, readAt: new Date() },
    })

    return result.count
  }

  async getUnreadCount(userId: string, storeId?: string | null): Promise<number> {
    try {
      if (!userId || typeof userId !== 'string') {
        throw new Error('Invalid userId provided for getUnreadCount')
      }

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { createdAt: true, role: true },
      })

      const where: any = { userId, read: false }

      if (user?.createdAt) {
        where.createdAt = { gte: user.createdAt }
      }

      if (storeId && user?.role !== 'CUSTOMER') {
        where.OR = [
          { Ticket: { storeId } },
          { ticketId: null },
        ]
      }

      return await prisma.notification.count({ where })
    } catch (error) {
      console.error('Error getting unread count:', error)
      throw error
    }
  }

  async getNotifications(
    userId: string,
    options: {
      page?: number
      limit?: number
      read?: boolean
      type?: Notification_type
      storeId?: string | null
    } = {}
  ) {
    const page = options.page || 1
    const limit = options.limit || 20
    const skip = (page - 1) * limit

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { createdAt: true, role: true },
    })

    const where: any = { userId }

    if (user?.createdAt) {
      where.createdAt = { gte: user.createdAt }
    }

    if (options.read !== undefined) {
      where.read = options.read
    }

    if (options.type) {
      where.type = options.type
    }

    if (options.storeId && user?.role !== 'CUSTOMER') {
      where.OR = [
        { Ticket: { storeId: options.storeId } },
        { ticketId: null },
      ]
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        include: {
          Ticket: {
            select: { id: true, ticketNumber: true, subject: true },
          },
          User_Notification_actorIdToUser: {
            select: { id: true, name: true, email: true },
          },
          FacebookNotification: {
            select: {
              id: true,
              postUrl: true,
              type: true,
              facebookPostId: true,
              converted: true,
              convertedTicketId: true,
              Ticket: {
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
        where: { ...where, read: false },
      }),
    ])

    const enhancedNotifications = notifications.map((notification: any) => {
      const metadata = notification.metadata as any || {}
      const facebookNotification = notification.FacebookNotification

      let updatedMetadata = { ...metadata }

      if (facebookNotification?.converted && facebookNotification?.Ticket) {
        const ticket = facebookNotification.Ticket
        updatedMetadata = {
          ...updatedMetadata,
          converted: true,
          convertedTicketId: ticket.id,
          convertedTicketNumber: ticket.ticketNumber,
          convertedTicketStatus: ticket.status,
        }
      }

      return {
        ...notification,
        metadata: updatedMetadata,
        facebookNotification: facebookNotification ? {
          id: facebookNotification.id,
          postUrl: facebookNotification.postUrl,
          type: facebookNotification.type,
          facebookPostId: facebookNotification.facebookPostId,
        } : null
      }
    })

    return {
      notifications: enhancedNotifications,
      total,
      unreadCount,
      page,
      totalPages: Math.ceil(total / limit),
    }
  }

  async deleteNotification(notificationId: string, userId: string) {
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

export const notificationService = new NotificationService()
