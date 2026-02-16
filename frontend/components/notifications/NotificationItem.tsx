'use client'

import { useState, useEffect } from 'react'
import { Ticket, MessageSquare, AtSign, AlertCircle, CheckCircle, Clock, X, FileText, Loader2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatDistanceToNow } from 'date-fns'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

interface NotificationItemProps {
  notification: {
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
      pageId?: string
      pageName?: string
      postId?: string
      author?: string
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
    facebookNotification?: {
      id: string
      postUrl: string | null
      type: string
      facebookPostId: string | null
    } | null
  }
  onMarkAsRead: (id: string) => void
  onDelete: (id: string) => void
}

import { useStore } from '@/lib/store-context'

// ... existing imports

export function NotificationItem({ notification, onMarkAsRead, onDelete }: NotificationItemProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const { selectedStoreId } = useStore() // Get selected store
  const [isConverting, setIsConverting] = useState(false)
  const [convertedTicketStatus, setConvertedTicketStatus] = useState<string | null>(null)
  
  const Icon = getNotificationIcon(notification.type)
  const iconColor = getIconColor(notification.type)
  const priorityColor = getPriorityColor(notification.metadata?.priority)
  const isFacebookNotification = ['FACEBOOK_POST', 'FACEBOOK_COMMENT', 'FACEBOOK_MESSAGE'].includes(notification.type)
  
  // Only ADMIN users can delete notifications
  const canDelete = session?.user?.role === 'ADMIN'
  
  // Check if notification is already converted
  const isConverted = notification.metadata?.converted === true || notification.metadata?.convertedTicketId !== undefined
  const ticketStatus = notification.metadata?.convertedTicketStatus || convertedTicketStatus
  const ticketNumber = notification.metadata?.convertedTicketNumber
  const ticketId = notification.metadata?.convertedTicketId

  // Fetch converted ticket status on mount if converted
  useEffect(() => {
    if (isConverted && ticketId && !ticketStatus) {
      fetch(`/api/tickets/${ticketId}`)
        .then(res => res.json())
        .then(data => {
          if (data.ticket) {
            setConvertedTicketStatus(data.ticket.status)
          }
        })
        .catch(console.error)
    }
  }, [isConverted, ticketId, ticketStatus])

  const handleClick = (e: React.MouseEvent) => {
    // Don't trigger if clicking on action buttons
    if ((e.target as HTMLElement).closest('button, a')) {
      return
    }

    if (!notification.read) {
      onMarkAsRead(notification.id)
    }
    
    // For Facebook notifications, clicking card does nothing (use Create Ticket button instead)
    if (isFacebookNotification) {
      return
    }
    
    // For converted non-Facebook notifications, clicking card goes to ticket
    if (isConverted && ticketId) {
      router.push(`/agent/tickets/${ticketId}`)
      return
    }
    
    // Navigate to ticket if ticketId exists
    if (notification.ticketId || notification.ticket?.id) {
      const ticketId = notification.ticketId || notification.ticket?.id
      router.push(`/agent/tickets/${ticketId}`)
    }
  }

  const handleViewTicket = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card click from firing
    if (!notification.read) {
      onMarkAsRead(notification.id)
    }
    
    // "View Ticket" button always opens the ticket
    if (isConverted && ticketId) {
      router.push(`/agent/tickets/${ticketId}`)
      return
    }
    
    // Fallback: if ticketId exists, open ticket
    if (notification.ticketId || notification.ticket?.id) {
      const ticketId = notification.ticketId || notification.ticket?.id
      router.push(`/agent/tickets/${ticketId}`)
    }
  }

  const handleConvertToTicket = async (e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (!isFacebookNotification || !notification.facebookNotification?.id) {
      return
    }

    setIsConverting(true)
    
    try {
      const response = await fetch('/api/tickets/convert-facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          facebookNotificationId: notification.facebookNotification.id,
          storeId: selectedStoreId, // Pass selected store ID
        }),
      })
      // ... existing code

      const data = await response.json()

      if (response.ok && data.ticket) {
        // Update local state to show converted badge
        setConvertedTicketStatus(data.ticket.status)
        // Refresh the notification to get updated metadata
        window.location.reload()
        // Navigate to the new ticket
        router.push(`/agent/tickets/${data.ticket.id}`)
      } else {
        alert(data.error || 'Failed to convert notification to ticket')
      }
    } catch (error) {
      console.error('Error converting to ticket:', error)
      alert('Failed to convert notification to ticket')
    } finally {
      setIsConverting(false)
    }
  }

  return (
    <div
      className={cn(
        'group relative px-6 py-4 cursor-pointer transition-all hover:bg-gray-50',
        !notification.read && 'bg-blue-50/50'
      )}
      onClick={handleClick}
    >
      {/* Unread Indicator */}
      {!notification.read && (
        <div className="absolute left-2 top-1/2 -translate-y-1/2 w-2 h-2 bg-blue-600 rounded-full" />
      )}

      <div className="flex gap-3">
        {/* Icon */}
        <div className={cn('flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center', iconColor)}>
          <Icon className="w-5 h-5 text-white" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title */}
          <div className="flex items-start justify-between gap-2 mb-1">
            <h4 className={cn(
              'text-sm font-semibold text-gray-900 line-clamp-1',
              !notification.read && 'font-bold'
            )}>
              {notification.title}
            </h4>
            
            {/* Delete Button (shown on hover, only for ADMIN users) */}
            {canDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(notification.id)
                }}
                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-all"
                aria-label="Delete notification"
              >
                <X className="w-4 h-4 text-gray-500" />
              </button>
            )}
          </div>

          {/* Message */}
          <p className="text-sm text-gray-600 line-clamp-2 mb-2">
            {notification.message}
          </p>

          {/* Metadata */}
          {(notification.metadata || notification.ticket) && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mb-2">
              {/* Converted Badge */}
              {isConverted && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700 border border-green-200">
                  <CheckCircle2 className="w-3 h-3" />
                  Converted
                  {ticketNumber && (
                    <span className="font-semibold">#{ticketNumber}</span>
                  )}
                  {ticketStatus && (
                    <span className={cn(
                      'px-1.5 py-0.5 rounded text-xs font-medium',
                      ticketStatus === 'RESOLVED' || ticketStatus === 'CLOSED' ? 'bg-green-200 text-green-800' :
                      ticketStatus === 'IN_PROGRESS' ? 'bg-blue-200 text-blue-800' :
                      ticketStatus === 'NEW' || ticketStatus === 'OPEN' ? 'bg-yellow-200 text-yellow-800' :
                      'bg-gray-200 text-gray-800'
                    )}>
                      {ticketStatus.replace('_', ' ')}
                    </span>
                  )}
                </span>
              )}
              
              {(notification.ticket?.ticketNumber || notification.metadata?.ticketNumber) && !isConverted && (
                <span className="inline-flex items-center gap-1 font-medium text-blue-600">
                  <Ticket className="w-3.5 h-3.5" />
                  #{notification.ticket?.ticketNumber || notification.metadata?.ticketNumber}
                </span>
              )}
              
              {notification.metadata?.customerName && (
                <span className="inline-flex items-center gap-1">
                  👤 {notification.metadata.customerName}
                </span>
              )}
              
              {notification.metadata?.priority && (
                <span className={cn(
                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-medium',
                  priorityColor
                )}>
                  {notification.metadata.priority}
                </span>
              )}
            </div>
          )}

          {/* Preview (for replies) */}
          {notification.metadata?.preview && (
            <div className="bg-gray-100 rounded-lg px-3 py-2 mb-2">
              <p className="text-xs text-gray-600 italic line-clamp-2">
                &quot;{notification.metadata.preview}&quot;
              </p>
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between">
            {/* Timestamp */}
            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
              <Clock className="w-3.5 h-3.5" />
              {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
            </span>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              {/* Create Ticket Button - Show for non-converted Facebook notifications */}
              {isFacebookNotification && notification.facebookNotification?.id && !isConverted && (
                <button
                  onClick={handleConvertToTicket}
                  disabled={isConverting}
                  className={cn(
                    'inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md transition-all',
                    'bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800',
                    'disabled:opacity-50 disabled:cursor-not-allowed',
                    'shadow-sm hover:shadow'
                  )}
                  title="Create ticket from this Facebook notification"
                >
                  {isConverting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    <>
                      <FileText className="w-3.5 h-3.5" />
                      Create Ticket
                    </>
                  )}
                </button>
              )}
              {/* View Ticket Button - Only show for converted notifications */}
              {isConverted && ticketId && (
                <button
                  onClick={handleViewTicket}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 active:bg-green-800 transition-all shadow-sm hover:shadow"
                >
                  <Ticket className="w-3.5 h-3.5" />
                  View Ticket
                </button>
              )}
              {/* For other notifications */}
              {!isConverted && !isFacebookNotification && (
                <span className="text-xs font-medium text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                  View →
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// Helper functions
function getNotificationIcon(type: string) {
  const icons: Record<string, any> = {
    TICKET_ASSIGNED: Ticket,
    TICKET_UPDATED: Ticket,
    TICKET_REPLY: MessageSquare,
    TICKET_STATUS_CHANGED: CheckCircle,
    TICKET_MENTION: AtSign,
    SLA_BREACH: AlertCircle,
    PRIORITY_ESCALATION: AlertCircle,
    FACEBOOK_POST: MessageSquare,
    FACEBOOK_COMMENT: MessageSquare,
    FACEBOOK_MESSAGE: MessageSquare,
  }
  return icons[type] || Ticket
}

function getIconColor(type: string) {
  const colors: Record<string, string> = {
    TICKET_ASSIGNED: 'bg-blue-600',
    TICKET_UPDATED: 'bg-blue-500',
    TICKET_REPLY: 'bg-green-500',
    TICKET_STATUS_CHANGED: 'bg-emerald-500',
    TICKET_MENTION: 'bg-purple-500',
    SLA_BREACH: 'bg-red-500',
    PRIORITY_ESCALATION: 'bg-orange-500',
    FACEBOOK_POST: 'bg-blue-700',
    FACEBOOK_COMMENT: 'bg-blue-600',
    FACEBOOK_MESSAGE: 'bg-blue-500',
  }
  return colors[type] || 'bg-gray-500'
}

function getPriorityColor(priority?: string) {
  if (!priority) return ''
  
  const colors: Record<string, string> = {
    LOW: 'bg-gray-100 text-gray-700',
    NORMAL: 'bg-blue-100 text-blue-700',
    HIGH: 'bg-orange-100 text-orange-700',
    URGENT: 'bg-red-100 text-red-700',
  }
  return colors[priority.toUpperCase()] || 'bg-gray-100 text-gray-700'
}

