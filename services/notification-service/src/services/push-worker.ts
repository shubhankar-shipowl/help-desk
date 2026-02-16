import webpush from 'web-push'
import { prisma } from '../config/database'
import { pushQueue } from './queues'

if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
  && process.env.VAPID_PUBLIC_KEY !== 'your-vapid-public-key'
  && process.env.VAPID_PRIVATE_KEY !== 'your-vapid-private-key') {
  try {
    webpush.setVapidDetails(
      `mailto:${process.env.SMTP_USER || 'noreply@example.com'}`,
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY
    )
    console.log('[Push Worker] VAPID keys configured successfully')
  } catch (err) {
    console.warn('[Push Worker] Invalid VAPID keys, push notifications disabled:', (err as Error).message)
  }
} else {
  console.warn('[Push Worker] VAPID keys not configured, push notifications disabled')
}

pushQueue.process(
  'send-push',
  10,
  async (job) => {
    const { notificationId, userId, title, body, url, icon } = job.data

    try {
      const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId, isActive: true },
      })

      if (subscriptions.length === 0) {
        console.log(`No push subscriptions for user ${userId}`)

        await prisma.notificationDeliveryLog.updateMany({
          where: { notificationId, channel: 'PUSH' },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorMessage: 'No active push subscriptions',
          },
        })

        return { success: false, reason: 'no_subscriptions' }
      }

      const payload = JSON.stringify({
        title,
        body,
        icon: icon || undefined,
        badge: undefined,
        url: url || '/',
        timestamp: Date.now(),
      })

      const results = await Promise.allSettled(
        subscriptions.map((subscription: any) =>
          webpush.sendNotification(
            {
              endpoint: subscription.endpoint,
              keys: {
                p256dh: subscription.p256dh,
                auth: subscription.auth,
              },
            },
            payload
          )
        )
      )

      const invalidSubscriptions: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const error: any = result.reason
          if (error.statusCode === 410 || error.statusCode === 404) {
            invalidSubscriptions.push(subscriptions[index].id)
          }
        }
      })

      if (invalidSubscriptions.length > 0) {
        await prisma.pushSubscription.updateMany({
          where: { id: { in: invalidSubscriptions } },
          data: { isActive: false },
        })
      }

      const successCount = results.filter(r => r.status === 'fulfilled').length

      await prisma.notificationDeliveryLog.updateMany({
        where: { notificationId, channel: 'PUSH' },
        data: {
          status: successCount > 0 ? 'SENT' : 'FAILED',
          sentAt: successCount > 0 ? new Date() : undefined,
          failedAt: successCount === 0 ? new Date() : undefined,
          errorMessage: successCount === 0 ? 'All subscriptions failed' : undefined,
        },
      })

      console.log(`Push notification sent: ${successCount}/${subscriptions.length} successful`)
      return { success: true, sentTo: successCount, total: subscriptions.length }
    } catch (error: any) {
      console.error(`Push notification failed for ${notificationId}:`, error)

      await prisma.notificationDeliveryLog.updateMany({
        where: { notificationId, channel: 'PUSH' },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          errorMessage: error.message || 'Unknown error',
          attempts: { increment: 1 },
        },
      })

      throw error
    }
  }
)

pushQueue.on('completed', (job) => {
  console.log(`Push job ${job.id} completed`)
})

pushQueue.on('failed', (job, err) => {
  console.error(`Push job ${job?.id} failed:`, err.message)
})

export { pushQueue as pushWorker }
