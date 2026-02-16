import Redis from 'ioredis'
import { getRedisUrl } from '../config/redis'

let publisher: Redis | null = null
let subscriber: Redis | null = null

export function getRedisPublisher(): Redis {
  if (!publisher) {
    publisher = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
    })
  }
  return publisher
}

export function getRedisSubscriber(): Redis {
  if (!subscriber) {
    subscriber = new Redis(getRedisUrl(), {
      maxRetriesPerRequest: null,
    })
  }
  return subscriber
}

export async function publishNotification(notification: any) {
  try {
    const pub = getRedisPublisher()
    const message = JSON.stringify(notification)
    await pub.publish('notifications', message)
    console.log('[PubSub] Published notification to Redis channel:', {
      channel: 'notifications',
      notificationId: notification.id,
      userId: notification.userId,
      type: notification.type,
    })
  } catch (error) {
    console.error('[PubSub] Error publishing notification to Redis:', error)
    throw error
  }
}

export function subscribeToNotifications(callback: (notification: any) => void) {
  try {
    const sub = getRedisSubscriber()

    sub.subscribe('notifications', (err, count) => {
      if (err) {
        console.error('[PubSub] Failed to subscribe to notifications:', err)
      } else {
        console.log(`[PubSub] Subscribed to ${count} channel(s)`)
      }
    })

    sub.on('message', (channel, message) => {
      if (channel === 'notifications') {
        try {
          const notification = JSON.parse(message)
          callback(notification)
        } catch (error) {
          console.error('[PubSub] Error parsing notification message:', error)
        }
      }
    })

    sub.on('error', (error) => {
      console.error('[PubSub] Redis subscriber error:', error)
    })

    return () => {
      sub.unsubscribe('notifications')
    }
  } catch (error) {
    console.error('[PubSub] Error setting up Redis subscription:', error)
  }
}
