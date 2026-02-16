'use client'

import { useState, useEffect } from 'react'
import { NotificationItem } from './NotificationItem'
import { EmptyNotifications } from './EmptyNotifications'
import { Button } from '@/components/ui/button'
import { useNotificationSocket } from '@/lib/notifications/client'
import { useStore } from '@/lib/store-context'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  ticketId?: string
  read: boolean
  createdAt: string | Date
  metadata?: {
    priority?: string
    customerName?: string
    ticketSubject?: string
    preview?: string
    ticketNumber?: string
  }
  ticket?: {
    id: string
    ticketNumber: string
    subject?: string
  }
}

export function NotificationList() {
  const socket = useNotificationSocket()
  const { selectedStoreId } = useStore()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    fetchNotifications()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStoreId])

  useEffect(() => {
    if (!socket) return

    socket.on('notification:new', (notification: Notification) => {
      setNotifications((prev) => [notification, ...prev])
      setUnreadCount((prev) => prev + 1)
    })

    socket.on('notification:marked-read', (notificationId: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    })

    return () => {
      socket.off('notification:new')
      socket.off('notification:marked-read')
    }
  }, [socket])

  async function fetchNotifications() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('limit', '50')
      
      // Add storeId if available (for admins/agents)
      if (selectedStoreId) {
        params.append('storeId', selectedStoreId)
      }
      
      const response = await fetch(`/api/notifications?${params.toString()}`)
      const data = await response.json()
      setNotifications(data.notifications || [])
      setUnreadCount(data.unreadCount || 0)
    } catch (error) {
      console.error('Error fetching notifications:', error)
    } finally {
      setLoading(false)
    }
  }

  async function markAllAsRead() {
    try {
      const params = new URLSearchParams()
      // Add storeId if available (for admins/agents)
      if (selectedStoreId) {
        params.append('storeId', selectedStoreId)
      }
      
      await fetch(`/api/notifications/mark-all-read?${params.toString()}`, { method: 'PATCH' })
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
      
      if (socket) {
        socket.emit('notification:mark-all-read')
      }
    } catch (error) {
      console.error('Error marking all as read:', error)
    }
  }

  async function markAsRead(notificationId: string) {
    try {
      await fetch(`/api/notifications/${notificationId}`, { method: 'PATCH' })
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
      
      if (socket) {
        socket.emit('notification:read', notificationId)
      }
    } catch (error) {
      console.error('Error marking as read:', error)
    }
  }

  async function deleteNotification(notificationId: string) {
    try {
      await fetch(`/api/notifications/${notificationId}`, { method: 'DELETE' })
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId))
    } catch (error) {
      console.error('Error deleting notification:', error)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {notifications.length > 0 && unreadCount > 0 && (
        <div className="flex justify-end">
          <Button onClick={markAllAsRead} variant="outline" size="sm">
            Mark all as read
          </Button>
        </div>
      )}

      {notifications.length === 0 ? (
        <EmptyNotifications filter="all" />
      ) : (
        <div className="space-y-2">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onMarkAsRead={markAsRead}
              onDelete={deleteNotification}
            />
          ))}
        </div>
      )}
    </div>
  )
}

