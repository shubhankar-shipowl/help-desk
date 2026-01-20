import Queue from 'bull'
import { NotificationType } from '@prisma/client'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

console.log('[Email Queue] 🔗 Connecting to Redis:', redisUrl.replace(/\/\/.*@/, '//***@')) // Hide password in logs

// Create queues for different notification channels
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

// Add event listeners to track queue status
emailQueue.on('ready', () => {
  console.log('[Email Queue] ✅ Queue ready and connected to Redis')
})

emailQueue.on('error', (error) => {
  console.error('[Email Queue] ❌ Queue error:', error.message)
})

emailQueue.on('waiting', (jobId) => {
  console.log(`[Email Queue] ⏳ Job waiting: ${jobId}`)
})

emailQueue.on('active', (job) => {
  console.log(`[Email Queue] 🔄 Job active: ${job.id}`)
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

/**
 * Get priority for notification type
 */
function getPriority(type: NotificationType): number {
  const priorityMap: Record<NotificationType, number> = {
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

/**
 * Queue email notification
 */
export async function queueEmailNotification(data: {
  notificationId: string
  to: string
  subject: string
  html?: string
  text?: string
  type: NotificationType
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
    console.log(`[Email Queue] ✅ Email job queued:`, {
      jobId: job.id,
      notificationId: data.notificationId,
      to: data.to,
      type: data.type,
    })
    return job
  } catch (error: any) {
    console.error(`[Email Queue] ❌ Failed to queue email:`, {
      notificationId: data.notificationId,
      to: data.to,
      error: error.message,
    })
    throw error
  }
}

/**
 * Queue push notification
 */
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

/**
 * Queue Facebook notification
 */
export async function queueFacebookNotification(data: {
  notificationId: string
  type: NotificationType
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

