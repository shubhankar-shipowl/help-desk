'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, X, Settings, Ticket, MessageSquare, AtSign, AlertCircle, Calendar } from 'lucide-react'
import { cn } from '@/lib/utils'
import { NotificationItem } from './NotificationItem'
import { EmptyNotifications } from './EmptyNotifications'
import { useNotificationSocket } from '@/lib/notifications/client'
import { useRouter } from 'next/navigation'

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
    isMention?: boolean
    pageId?: string
    pageName?: string
    postId?: string
    author?: string
    authorId?: string
    detectedVia?: string
    converted?: boolean
    convertedTicketId?: string
    convertedTicketNumber?: string
    convertedTicketStatus?: string
  }
  ticket?: {
    id: string
    ticketNumber: string
    subject?: string
  }
  actor?: {
    id: string
    name: string | null
    email: string
  }
  facebookNotification?: {
    id: string
    postUrl: string | null
    type: string
    facebookPostId: string | null
  } | null
}

type FilterType = 'all' | 'tickets' | 'mentions' | 'system'

export function NotificationDropdown() {
  const router = useRouter()
  const socket = useNotificationSocket()
  const [isOpen, setIsOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<FilterType>('all')
  const [unreadCount, setUnreadCount] = useState(0)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Fetch notifications
  useEffect(() => {
    if (isOpen) {
      fetchNotifications()
    }
  }, [isOpen, filter])

  // Fetch unread count on mount
  useEffect(() => {
    fetchUnreadCount()
    
    // Set up polling for real-time updates
    const interval = setInterval(fetchUnreadCount, 30000) // Every 30 seconds
    
    return () => clearInterval(interval)
  }, [])

  // WebSocket event listeners
  useEffect(() => {
    if (!socket) return

    // Listen for new notifications
    socket.on('notification:new', (notification: Notification) => {
      setNotifications((prev) => [notification, ...prev])
      setUnreadCount((prev) => prev + 1)
      
      // Show browser notification
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(notification.title, {
          body: notification.message,
          // Use data URI for icon to avoid 404 errors
          icon: undefined, // Browser will use default icon
          badge: undefined, // Browser will use default badge
        })
      }
    })

    // Listen for notification marked as read
    socket.on('notification:marked-read', (notificationId: string) => {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    })

    // Listen for unread count updates
    socket.on('notification:unread-count', (count: number) => {
      setUnreadCount(count)
    })

    return () => {
      socket.off('notification:new')
      socket.off('notification:marked-read')
      socket.off('notification:unread-count')
    }
  }, [socket])

  async function fetchNotifications() {
    setLoading(true)
    try {
      // Fetch all notifications, then filter client-side
      // This allows us to filter by multiple types per category
      const params = new URLSearchParams()
      params.append('limit', '50') // Fetch more to allow filtering
      
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

  async function fetchUnreadCount() {
    try {
      const response = await fetch('/api/notifications/unread-count')
      const data = await response.json()
      setUnreadCount(data.count || 0)
    } catch (error) {
      console.error('Error fetching unread count:', error)
    }
  }

  async function markAllAsRead() {
    try {
      await fetch('/api/notifications/mark-all-read', { method: 'PATCH' })
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

  // Filter notifications based on selected filter
  const filteredNotifications = notifications.filter((notification) => {
    if (filter === 'all') return true
    if (filter === 'tickets') {
      return ['TICKET_ASSIGNED', 'TICKET_UPDATED', 'TICKET_REPLY', 'TICKET_STATUS_CHANGED'].includes(notification.type)
    }
    if (filter === 'mentions') {
      // Include ticket mentions and Facebook page mentions
      return (
        notification.type === 'TICKET_MENTION' ||
        (notification.type === 'FACEBOOK_MESSAGE' && notification.metadata?.isMention === true)
      )
    }
    if (filter === 'system') {
      return ['SLA_BREACH', 'PRIORITY_ESCALATION'].includes(notification.type)
    }
    return true
  })

  // Group notifications by time
  const groupedNotifications = groupNotificationsByTime(filteredNotifications)

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Bell Icon Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-gray-100 transition-colors"
        aria-label={`Notifications. ${unreadCount} unread.`}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <Bell className="w-6 h-6 text-gray-600" />
        
        {/* Unread Badge */}
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[20px] h-5 px-1.5 text-xs font-bold text-white bg-red-500 rounded-full animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      {isOpen && (
        <>
          {/* Mobile Overlay */}
          <div 
            className="fixed inset-0 bg-black/50 z-40 lg:hidden"
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown Panel */}
          <div className="fixed lg:absolute right-0 top-16 lg:top-auto lg:mt-2 w-full lg:w-[420px] max-w-[420px] lg:max-w-none h-[calc(100vh-4rem)] lg:h-auto lg:max-h-[600px] bg-white rounded-t-2xl lg:rounded-2xl shadow-2xl border border-gray-200 z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          {/* Header */}
          <div className="sticky top-0 bg-white border-b border-gray-200 z-10">
            {/* Title Row */}
            <div className="flex items-center justify-between px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900">
                Notifications
              </h3>
              <div className="flex items-center gap-2">
                {unreadCount > 0 && (
                  <button
                    onClick={markAllAsRead}
                    className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  onClick={() => {
                    setIsOpen(false)
                    router.push('/settings/notifications')
                  }}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
                  aria-label="Notification Settings"
                >
                  <Settings className="w-5 h-5 text-gray-500" />
                </button>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors lg:hidden"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Filter Tabs */}
            <div className="flex gap-2 px-6 pb-3">
              {[
                { value: 'all', label: 'All' },
                { value: 'tickets', label: 'Tickets' },
                { value: 'mentions', label: 'Mentions' },
                { value: 'system', label: 'System' },
              ].map((tab) => (
                <button
                  key={tab.value}
                  onClick={() => setFilter(tab.value as FilterType)}
                  className={cn(
                    'px-4 py-1.5 text-sm font-medium rounded-full transition-all',
                    filter === tab.value
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-gray-600 hover:bg-gray-100'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="max-h-[536px] overflow-y-auto">
            {loading ? (
              // Loading State
              <div className="flex flex-col items-center justify-center py-12">
                <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-sm text-gray-500">Loading notifications...</p>
              </div>
            ) : filteredNotifications.length === 0 ? (
              // Empty State
              <EmptyNotifications filter={filter} />
            ) : (
              // Notifications List
              <div className="divide-y divide-gray-100">
                {Object.entries(groupedNotifications).map(([timeGroup, items]) => (
                  <div key={timeGroup}>
                    {/* Time Group Header */}
                    <div className="sticky top-0 bg-gray-50 px-6 py-2 z-10">
                      <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {timeGroup}
                      </h4>
                    </div>

                    {/* Notifications in Group */}
                    {items.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        onMarkAsRead={markAsRead}
                        onDelete={deleteNotification}
                      />
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {filteredNotifications.length > 0 && (
            <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-6 py-3">
              <button
                onClick={() => {
                  setIsOpen(false)
                  router.push('/notifications')
                }}
                className="block w-full text-center text-sm font-medium text-blue-600 hover:text-blue-700 transition-colors"
              >
                View All Notifications →
              </button>
            </div>
          )}
          </div>
        </>
      )}
    </div>
  )
}

// Helper function to group notifications by time
function groupNotificationsByTime(notifications: Notification[]) {
  const now = new Date()
  const groups: Record<string, Notification[]> = {
    'New': [],
    'Earlier Today': [],
    'Yesterday': [],
    'This Week': [],
    'Older': [],
  }

  notifications.forEach((notification) => {
    const notificationDate = new Date(notification.createdAt)
    const diffInMinutes = Math.floor((now.getTime() - notificationDate.getTime()) / (1000 * 60))
    const diffInHours = Math.floor(diffInMinutes / 60)
    const diffInDays = Math.floor(diffInHours / 24)

    if (diffInMinutes < 60 && !notification.read) {
      groups['New'].push(notification)
    } else if (diffInHours < 24) {
      groups['Earlier Today'].push(notification)
    } else if (diffInDays === 1) {
      groups['Yesterday'].push(notification)
    } else if (diffInDays < 7) {
      groups['This Week'].push(notification)
    } else {
      groups['Older'].push(notification)
    }
  })

  // Remove empty groups
  return Object.fromEntries(
    Object.entries(groups).filter(([_, items]) => items.length > 0)
  )
}

