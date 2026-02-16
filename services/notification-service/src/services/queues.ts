import Queue from 'bull'
import { Notification_type } from '@prisma/client'
import { getRedisUrl } from '../config/redis'

const redisUrl = getRedisUrl()

export const emailQueue = new Queue('email-notifications', redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
})

emailQueue.on('ready', () => {
  console.log('[Email Queue] Queue ready and connected to Redis')
})

emailQueue.on('error', (error) => {
  console.error('[Email Queue] Queue error:', error.message)
})

export const pushQueue = new Queue('push-notifications', redisUrl, {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
})

export const facebookQueue = new Queue('facebook-notifications', redisUrl, {
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: 'exponential',
      delay: 3000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
})

function getPriority(type: Notification_type): number {
  const priorityMap: Record<Notification_type, number> = {
    SLA_BREACH: 1,
    PRIORITY_ESCALATION: 2,
    TICKET_ASSIGNED: 3,
    TICKET_REPLY: 4,
    TICKET_UPDATED: 5,
    TICKET_STATUS_CHANGED: 5,
    TICKET_MENTION: 6,
    FACEBOOK_MESSAGE: 7,
    FACEBOOK_COMMENT: 8,
    FACEBOOK_POST: 9,
  }
  return priorityMap[type] || 5
}

export async function queueEmailNotification(data: {
  notificationId: string
  to: string
  subject: string
  html?: string
  text?: string
  type: Notification_type
  userId: string
  tenantId?: string
  storeId?: string | null
  inReplyTo?: string
  references?: string
}) {
  try {
    const job = await emailQueue.add(
      'send-email',
      data,
      {
        priority: getPriority(data.type),
        jobId: `email-${data.notificationId}`,
      }
    )
    console.log(`[Email Queue] Email job queued:`, {
      jobId: job.id,
      notificationId: data.notificationId,
      to: data.to,
      type: data.type,
    })
    return job
  } catch (error: any) {
    console.error(`[Email Queue] Failed to queue email:`, {
      notificationId: data.notificationId,
      to: data.to,
      error: error.message,
    })
    throw error
  }
}

export async function queuePushNotification(data: {
  notificationId: string
  userId: string
  title: string
  body: string
  url?: string
  icon?: string
}) {
  await pushQueue.add(
    'send-push',
    data,
    {
      priority: 5,
      jobId: `push-${data.notificationId}`,
    }
  )
}

export async function queueFacebookNotification(data: {
  notificationId: string
  type: Notification_type
  data: any
}) {
  await facebookQueue.add(
    'handle-facebook',
    data,
    {
      priority: getPriority(data.type),
      jobId: `facebook-${data.notificationId}`,
    }
  )
}
