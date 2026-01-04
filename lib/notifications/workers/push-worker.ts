import webpush from 'web-push'
import { prisma } from '../../prisma'
import { pushQueue } from '../queues'

// Configure web push (VAPID keys should be in environment variables)
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(
    `mailto:${process.env.SMTP_USER || 'noreply@example.com'}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  )
}

// Process push jobs
pushQueue.process(
  'send-push',
  10, // Concurrency: process 10 push notifications at a time
  async (job) => {
    const { notificationId, userId, title, body, url, icon } = job.data

    try {
      // Get user's push subscriptions
      const subscriptions = await prisma.pushSubscription.findMany({
        where: {
          userId,
          isActive: true,
        },
      })

      if (subscriptions.length === 0) {
        console.log(`No push subscriptions for user ${userId}`)
        
        // Update delivery log
        await prisma.notificationDeliveryLog.updateMany({
          where: {
            notificationId,
            channel: 'PUSH',
          },
          data: {
            status: 'FAILED',
            failedAt: new Date(),
            errorMessage: 'No active push subscriptions',
          },
        })

        return { success: false, reason: 'no_subscriptions' }
      }

      // Prepare notification payload
      const payload = JSON.stringify({
        title,
        body,
        icon: icon || undefined, // Use browser default icon to avoid 404 errors
        badge: undefined, // Use browser default badge to avoid 404 errors
        url: url || '/',
        timestamp: Date.now(),
      })

      // Send to all subscriptions
      const results = await Promise.allSettled(
        subscriptions.map(subscription =>
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

      // Remove invalid subscriptions
      const invalidSubscriptions: string[] = []
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          const error: any = result.reason
          if (error.statusCode === 410 || error.statusCode === 404) {
            // Subscription expired or not found
            invalidSubscriptions.push(subscriptions[index].id)
          }
        }
      })

      if (invalidSubscriptions.length > 0) {
        await prisma.pushSubscription.updateMany({
          where: {
            id: { in: invalidSubscriptions },
          },
          data: {
            isActive: false,
          },
        })
      }

      const successCount = results.filter(r => r.status === 'fulfilled').length

      // Update delivery log
      await prisma.notificationDeliveryLog.updateMany({
        where: {
          notificationId,
          channel: 'PUSH',
        },
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

      // Update delivery log
      await prisma.notificationDeliveryLog.updateMany({
        where: {
          notificationId,
          channel: 'PUSH',
        },
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

// Export the queue for external access
export { pushQueue as pushWorker }

