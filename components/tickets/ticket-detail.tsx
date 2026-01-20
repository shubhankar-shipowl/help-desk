'use client'

import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { formatDate, maskPhoneNumber, maskEmail } from '@/lib/utils'
import { useToast } from '@/components/ui/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Send, User, Paperclip, Smile, FileText, X, ExternalLink, Facebook, Phone, Image as ImageIcon, Video } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SatisfactionRating } from './satisfaction-rating'

interface TicketDetailProps {
  ticket: any
  currentUserId: string
  viewMode: 'customer' | 'agent'
  customerTickets?: any[]
  isPanel?: boolean
  currentUserRole?: 'ADMIN' | 'AGENT' | 'CUSTOMER'
  availableAgents?: Array<{ id: string; name: string | null; email: string }>
  availableTeams?: Array<{ id: string; name: string }>
  templates?: Array<{ 
    id: string
    name: string
    type: string
    content: any
    variables?: any
    category?: string | null
  }>
  currentUserPhone?: string | null
  onTicketUpdate?: (updatedTicket: any) => void
  onClose?: () => void
}

export function TicketDetail({
  ticket,
  currentUserId,
  viewMode,
  customerTickets,
  isPanel = false,
  currentUserRole,
  availableAgents = [],
  availableTeams = [],
  templates = [],
  currentUserPhone,
  onTicketUpdate,
  onClose,
}: TicketDetailProps) {
  const { toast } = useToast()
  const [comment, setComment] = useState('')
  const [isInternal, setIsInternal] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [customerTicketStats, setCustomerTicketStats] = useState({
    total: 0,
    open: 0,
    resolved: 0,
    avgResolutionTime: 'N/A',
  })
  const [ticketData, setTicketData] = useState({
    ...ticket,
    customer: {
      ...ticket.customer,
      phone: ticket.customer?.phone || null,
    },
    comments: ticket.comments || [],
  })
  const [attachments, setAttachments] = useState<File[]>([])
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [showMacroPicker, setShowMacroPicker] = useState(false)
  const [showCustomerDetails, setShowCustomerDetails] = useState(true)
  const [isCalling, setIsCalling] = useState(false)
  const [showCallDialog, setShowCallDialog] = useState(false)
  const [imageLoadErrors, setImageLoadErrors] = useState<Set<string>>(new Set())
  const [deliveredDate, setDeliveredDate] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<{ url: string; filename: string } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Fetch delivered date from order tracking data
  useEffect(() => {
    const fetchDeliveredDate = async () => {
      if (!ticketData.customer?.phone) {
        setDeliveredDate(null)
        return
      }

      try {
        // Normalize phone number
        const normalizedPhone = ticketData.customer.phone.replace(/[\s\-\(\)]/g, '')
        
        if (normalizedPhone.length < 10) {
          return
        }

        const response = await fetch(`/api/order-tracking/lookup?phone=${encodeURIComponent(normalizedPhone)}`)
        const data = await response.json()

        if (data.found && data.deliveredDate) {
          // Format the delivered date (date only, no time)
          const date = new Date(data.deliveredDate)
          const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
          })
          setDeliveredDate(formattedDate)
        } else if (data.found && data.data && data.data.length > 0) {
          // Check if any order has a delivered date
          const orderWithDeliveredDate = data.data.find((order: any) => order.deliveredDate)
          if (orderWithDeliveredDate) {
            const date = new Date(orderWithDeliveredDate.deliveredDate)
            const formattedDate = date.toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'short',
              day: 'numeric'
            })
            setDeliveredDate(formattedDate)
          } else {
            setDeliveredDate(null)
          }
        } else {
          setDeliveredDate(null)
        }
      } catch (error) {
        // Silently fail - don't show error if lookup fails
        console.error('Error fetching delivered date:', error)
        setDeliveredDate(null)
      }
    }

    fetchDeliveredDate()
  }, [ticketData.customer?.phone])

  // Helper function to check if attachment is an image
  const isImage = (mimeType: string | null | undefined, filename: string) => {
    if (!mimeType && !filename) return false
    const imageMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']
    if (mimeType && imageMimes.includes(mimeType.toLowerCase())) return true
    if (filename) {
      const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
      return imageExtensions.includes(ext)
    }
    return false
  }

  // Helper function to check if attachment is a video
  const isVideo = (mimeType: string | null | undefined, filename: string) => {
    if (!mimeType && !filename) return false
    const videoMimes = ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/ogg']
    const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.ogg', '.mpeg', '.mpg']
    if (mimeType && videoMimes.includes(mimeType.toLowerCase())) return true
    if (filename) {
      const ext = filename.toLowerCase().substring(filename.lastIndexOf('.'))
      return videoExtensions.includes(ext)
    }
    return false
  }

  // Update ticketData when ticket prop changes (from WebSocket updates)
  useEffect(() => {
    if (ticket && ticket.id === ticketData.id) {
      setTicketData({
        ...ticket,
        subject: ticket.subject || ticketData.subject || 'No subject',
        customer: {
          ...ticket.customer,
          phone: ticket.customer?.phone || ticketData.customer?.phone || null,
        },
        comments: ticket.comments || ticketData.comments || [],
      })
    }
  }, [ticket])

  // Fetch customer ticket stats
  useEffect(() => {
    const fetchCustomerTicketStats = async () => {
      if (!ticketData?.customerId) return

      try {
        // Fetch all tickets for this customer
        const response = await fetch(`/api/tickets?customerId=${ticketData.customerId}`)
        if (!response.ok) return

        const data = await response.json()
        const tickets = data.tickets || []

        // Calculate stats
        const total = tickets.length
        const open = tickets.filter(
          (t: any) => t.status === 'NEW' || t.status === 'OPEN' || t.status === 'PENDING'
        ).length
        const resolved = tickets.filter((t: any) => t.status === 'RESOLVED' || t.status === 'CLOSED').length

        // Calculate average resolution time
        const resolvedTickets = tickets.filter(
          (t: any) => (t.status === 'RESOLVED' || t.status === 'CLOSED') && t.resolvedAt
        )
        let avgResolutionTime = 'N/A'
        if (resolvedTickets.length > 0) {
          const totalHours = resolvedTickets.reduce((sum: number, t: any) => {
            const createdAt = new Date(t.createdAt).getTime()
            const resolvedAt = new Date(t.resolvedAt).getTime()
            const hours = (resolvedAt - createdAt) / (1000 * 60 * 60)
            return sum + hours
          }, 0)
          const avgHours = totalHours / resolvedTickets.length
          avgResolutionTime = `${avgHours.toFixed(1)} hours`
        }

        setCustomerTicketStats({
          total,
          open,
          resolved,
          avgResolutionTime,
        })
      } catch (error) {
        console.error('Error fetching customer ticket stats:', error)
      }
    }

    fetchCustomerTicketStats()
  }, [ticketData?.customerId, ticketData?.id])

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      // Limit to 5 files max
      const newFiles = [...attachments, ...files].slice(0, 5)
      setAttachments(newFiles)
      toast({
        title: 'Files selected',
        description: `${files.length} file(s) added`,
      })
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index))
  }

  const handleEmojiSelect = (emoji: string) => {
    setComment(comment + emoji)
    setShowEmojiPicker(false)
  }

  const handleMacroSelect = (macro: string) => {
    setComment(comment + macro)
    setShowMacroPicker(false)
  }

  const handleCommentSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!comment.trim() && attachments.length === 0) return

    // Safety check: ensure ticket has an ID
    if (!ticket?.id) {
      toast({
        title: 'Error',
        description: 'Ticket ID is missing',
        variant: 'destructive',
      })
      return
    }

    setIsLoading(true)
    try {
      // If there are attachments, use FormData
      if (attachments.length > 0) {
        const formData = new FormData()
        formData.append('content', comment)
        formData.append('isInternal', String(isInternal))
        attachments.forEach((file) => {
          formData.append('attachments', file)
        })

        const response = await fetch(`/api/tickets/${ticket.id}/comments`, {
          method: 'POST',
          body: formData,
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to add comment')
        }

        // Refresh comments from server to ensure we have the latest data
        const commentsResponse = await fetch(`/api/tickets/${ticket.id}/comments`)
        const commentsData = await commentsResponse.json()

        setTicketData({
          ...ticketData,
          comments: commentsData.comments || [],
        })
        setComment('')
        setAttachments([])
        setIsInternal(false)
        toast({
          title: 'Success',
          description: isInternal ? 'Internal note added successfully' : 'Comment with attachments added successfully',
        })
      } else {
        // No attachments, use JSON
        const response = await fetch(`/api/tickets/${ticket.id}/comments`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: comment, isInternal }),
        })

        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to add comment')
        }

        // Refresh comments from server to ensure we have the latest data
        const commentsResponse = await fetch(`/api/tickets/${ticket.id}/comments`)
        const commentsData = await commentsResponse.json()

        setTicketData({
          ...ticketData,
          comments: commentsData.comments || [],
        })
        setComment('')
        setIsInternal(false)
        toast({
          title: 'Success',
          description: isInternal ? 'Internal note added successfully' : 'Comment added successfully',
        })
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleStatusChange = async (status: string) => {
    // Optimistic update - update immediately
    const previousData = { ...ticketData }
    const optimisticUpdate = {
      ...ticketData,
      status: status as any,
      attachments: ticketData.attachments || [], // Preserve attachments in optimistic update
    }
    setTicketData(optimisticUpdate)
    
    // Notify parent immediately for instant UI update
    if (onTicketUpdate) {
      onTicketUpdate(optimisticUpdate)
    }

    // Safety check: ensure ticket has an ID
    if (!ticket?.id) {
      toast({
        title: 'Error',
        description: 'Ticket ID is missing',
        variant: 'destructive',
      })
      return
    }

    try {
      const response = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to update status' }))
        throw new Error(errorData.error || 'Failed to update status')
      }

      const data = await response.json()
      const updatedTicket = {
        ...data.ticket,
        comments: data.ticket.comments || ticketData.comments || [],
        attachments: data.ticket.attachments || ticketData.attachments || [], // Preserve attachments
      }
      setTicketData(updatedTicket)
      
      // Notify parent with server response
      if (onTicketUpdate) {
        onTicketUpdate(updatedTicket)
      }

      toast({
        title: 'Success',
        description: 'Ticket status updated',
      })
    } catch (error: any) {
      // Revert on error
      setTicketData(previousData)
      if (onTicketUpdate) {
        onTicketUpdate(previousData)
      }
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    }
  }

  const handleCall = () => {
    // Safety check: ensure ticket has an ID
    if (!ticket?.id) {
      toast({
        title: 'Error',
        description: 'Ticket ID is missing',
        variant: 'destructive',
      })
      return
    }

    // Check if customer has phone number
    if (!ticketData.customer?.phone) {
      toast({
        title: 'Error',
        description: 'Customer phone number is not available',
        variant: 'destructive',
      })
      return
    }

    // Show confirmation dialog
    setShowCallDialog(true)
  }

  const initiateCall = async () => {
    // Close dialog
    setShowCallDialog(false)

    // Safety check: ensure ticket has an ID
    if (!ticket?.id) {
      toast({
        title: 'Error',
        description: 'Ticket ID is missing',
        variant: 'destructive',
      })
      return
    }

    setIsCalling(true)
    try {
      const response = await fetch(`/api/tickets/${ticket.id}/call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const data = await response.json()

      if (!response.ok) {
        // If error is about phone configuration, provide helpful message
        if (data.error && data.error.includes('phone number is not configured')) {
          toast({
            title: 'Phone Number Required',
            description: 'Please configure your agent phone number in settings to make calls. Redirecting to settings...',
            variant: 'destructive',
          })
          // Redirect to settings after a short delay
          setTimeout(() => {
            window.location.href = '/settings/profile'
          }, 2000)
          return
        }
        throw new Error(data.error || 'Failed to initiate call')
      }

      toast({
        title: 'Success',
        description: 'Call initiated successfully',
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to initiate call',
        variant: 'destructive',
      })
    } finally {
      setIsCalling(false)
    }
  }

  const handleAgentChange = async (agentId: string) => {
    // Safety check: ensure ticket has an ID
    if (!ticket?.id) {
      toast({
        title: 'Error',
        description: 'Ticket ID is missing',
        variant: 'destructive',
      })
      return
    }

    // Convert "unassigned" string to null
    const assignedAgentId = agentId === 'unassigned' ? null : agentId
    
    // Optimistic update - update immediately
    const previousData = { ...ticketData }
    const selectedAgent = assignedAgentId 
      ? availableAgents.find(a => a.id === assignedAgentId)
      : null
    
    const optimisticUpdate = {
      ...ticketData,
      assignedAgentId: assignedAgentId,
      assignedAgent: assignedAgentId 
        ? { id: assignedAgentId, name: selectedAgent?.name || null, email: selectedAgent?.email || '' }
        : null,
      attachments: ticketData.attachments || [], // Preserve attachments in optimistic update
    }
    setTicketData(optimisticUpdate)
    
    // Notify parent immediately for instant UI update
    if (onTicketUpdate) {
      onTicketUpdate(optimisticUpdate)
    }

    try {
      const response = await fetch(`/api/tickets/${ticket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignedAgentId }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to assign agent')
      }

      const data = await response.json()
      const updatedTicket = {
        ...data.ticket,
        comments: data.ticket.comments || ticketData.comments || [],
        attachments: data.ticket.attachments || ticketData.attachments || [], // Preserve attachments
      }
      setTicketData(updatedTicket)
      
      // Notify parent with server response
      if (onTicketUpdate) {
        onTicketUpdate(updatedTicket)
      }

      toast({
        title: 'Success',
        description: assignedAgentId 
          ? `Ticket assigned to ${data.ticket.assignedAgent?.name || data.ticket.assignedAgent?.email || 'agent'}`
          : 'Ticket unassigned',
      })
    } catch (error: any) {
      // Revert on error
      setTicketData(previousData)
      if (onTicketUpdate) {
        onTicketUpdate(previousData)
      }
      toast({
        title: 'Error',
        description: error.message || 'Failed to update assignment',
        variant: 'destructive',
      })
    }
  }

  if (isPanel) {
    return (
      <div className="flex flex-col h-full">
        {/* Panel Header */}
        <div className="h-16 border-b border-gray-200 px-6 flex items-center justify-between bg-white">
          <div>
            <h2 className="font-semibold text-gray-900">#{ticketData.ticketNumber}</h2>
            <p className="text-sm text-gray-600">{ticketData.subject || 'No subject'}</p>
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 hover:bg-gray-100 rounded-full"
              onClick={onClose}
              aria-label="Close ticket detail"
            >
              <X className="h-5 w-5" />
            </Button>
          )}
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Customer Context Card */}
          <Card className="border border-gray-200 w-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">Customer Details</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 rounded-full hover:bg-gray-100"
                  onClick={() => setShowCustomerDetails(!showCustomerDetails)}
                  aria-label={showCustomerDetails ? 'Collapse customer details' : 'Expand customer details'}
                >
                  <span
                    className={`transition-transform text-lg ${
                      showCustomerDetails ? 'rotate-0' : 'rotate-180'
                    }`}
                  >
                    ▼
                  </span>
                </Button>
              </div>
            </CardHeader>
            {showCustomerDetails && (
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-gray-400" />
                  <span className="flex-1">
                    {ticketData.customer.name || maskEmail(ticketData.customer.email)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-400">📧</span>
                  <span className="flex-1 break-words">{maskEmail(ticketData.customer.email)}</span>
                </div>
                {ticketData.customer.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-gray-400" />
                    <span className="flex-1">
                      {maskPhoneNumber(ticketData.customer.phone)}
                    </span>
                    {viewMode === 'agent' && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={handleCall}
                        disabled={isCalling}
                        className="h-7 text-xs"
                      >
                        <Phone className="h-3.5 w-3.5 mr-1.5" />
                        {isCalling ? 'Calling...' : 'Call'}
                      </Button>
                    )}
                  </div>
                )}
                {viewMode === 'agent' && currentUserPhone && (
                  <div className="flex items-center gap-2 mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                    <Phone className="h-4 w-4 text-blue-600" />
                    <span className="text-xs text-blue-700 flex-1">
                      <span className="font-medium">Your number for calling:</span> {currentUserPhone}
                    </span>
                  </div>
                )}
                <div className="h-px bg-gray-200 my-3" />
                <div className="w-full">
                  <p className="font-medium mb-2">Ticket History</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-gray-50 p-2 rounded">
                      <p className="text-xs text-gray-500">Total</p>
                      <p className="text-sm font-semibold">
                        {customerTicketStats.total} {customerTicketStats.total === 1 ? 'ticket' : 'tickets'}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-2 rounded">
                      <p className="text-xs text-gray-500">Open</p>
                      <p className="text-sm font-semibold">{customerTicketStats.open}</p>
                    </div>
                    <div className="bg-gray-50 p-2 rounded">
                      <p className="text-xs text-gray-500">Resolved</p>
                      <p className="text-sm font-semibold">{customerTicketStats.resolved}</p>
                    </div>
                  </div>
                  <div className="mt-2 bg-gray-50 p-2 rounded">
                    <p className="text-xs text-gray-500">Avg Resolution</p>
                    <p className="text-sm font-semibold">{customerTicketStats.avgResolutionTime}</p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

          {/* Ticket Meta */}
          <Card className="border border-gray-200">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">Ticket Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Status</span>
                <Select 
                  key={`status-${ticketData.status}-${ticketData.id}`}
                  value={ticketData.status} 
                  onValueChange={handleStatusChange}
                >
                  <SelectTrigger className="w-32 h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEW">New</SelectItem>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="INITIATE_REFUND">Initiate Refund</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Priority</span>
                <Badge>{ticketData.priority}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Category</span>
                <span className="text-sm">{ticketData.category?.name || 'N/A'}</span>
              </div>
              {/* Facebook Link - Show for Facebook tickets */}
              {(ticketData.source === 'FACEBOOK_POST' || ticketData.source === 'FACEBOOK_COMMENT' || ticketData.source === 'FACEBOOK_MESSAGE') && 
               (ticketData.facebookPostUrl || (ticketData.FacebookNotification && ticketData.FacebookNotification.length > 0 && ticketData.FacebookNotification[0]?.postUrl)) && (
                <div className="flex items-center justify-between py-2 border-t border-gray-200">
                  <span className="text-sm text-gray-600 flex items-center gap-2">
                    <Facebook className="w-4 h-4 text-blue-600" />
                    Facebook
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                    onClick={() => {
                      const fbUrl = ticketData.facebookPostUrl || (ticketData.FacebookNotification && ticketData.FacebookNotification[0]?.postUrl)
                      if (fbUrl) {
                        window.open(fbUrl, '_blank', 'noopener,noreferrer')
                      }
                    }}
                  >
                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                    View on Facebook
                  </Button>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Assigned to</span>
                {currentUserRole === 'ADMIN' ? (
                  <Select
                    key={`${ticketData.assignedAgentId || 'unassigned'}-${ticketData.id}`}
                    value={ticketData.assignedAgentId || 'unassigned'}
                    onValueChange={handleAgentChange}
                  >
                    <SelectTrigger className="w-48 h-9">
                      <SelectValue placeholder="Select agent" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {availableAgents.map((agent) => (
                        <SelectItem key={agent.id} value={agent.id}>
                          {agent.name || agent.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <span className="text-sm">
                    {ticketData.assignedAgent?.name || ticketData.assignedAgent?.email || 'Unassigned'}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Created</span>
                <span className="text-sm">{formatDate(ticketData.createdAt)}</span>
              </div>
              {deliveredDate && (
                <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                  <span className="text-sm text-gray-600">Delivered Date</span>
                  <span className="text-sm font-medium text-green-600">{deliveredDate}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ticket Attachments */}
          {ticketData.attachments && ticketData.attachments.length > 0 && (
            <Card className="border border-gray-200">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Paperclip className="w-4 h-4" />
                  Attachments ({ticketData.attachments.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {ticketData.attachments.map((attachment: any) => {
                    const attachmentIsImage = isImage(attachment.mimeType, attachment.filename)
                    const attachmentIsVideo = isVideo(attachment.mimeType, attachment.filename)
                    
                    return (
                      <div
                        key={attachment.id}
                        className="border border-gray-200 rounded-lg overflow-hidden bg-white hover:shadow-md transition-shadow"
                      >
                        {attachmentIsImage && attachment.fileUrl ? (
                          <div className="relative w-full aspect-video bg-gray-100">
                            {imageLoadErrors.has(attachment.id) ? (
                              <div className="w-full h-full flex items-center justify-center bg-gray-100">
                                <ImageIcon className="w-8 h-8 text-gray-400" />
                              </div>
                            ) : (
                              <img
                                src={attachment.fileUrl}
                                alt={attachment.filename}
                                className="w-full h-full object-cover cursor-pointer hover:opacity-90 transition-opacity"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  if (attachment.fileUrl) {
                                    window.open(attachment.fileUrl, '_blank', 'noopener,noreferrer')
                                  }
                                }}
                                onError={() => {
                                  setImageLoadErrors(prev => new Set(prev).add(attachment.id))
                                }}
                              />
                            )}
                            <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                              <ImageIcon className="w-3 h-3" />
                              Image
                            </div>
                          </div>
                        ) : attachmentIsVideo && attachment.fileUrl ? (
                          <div className="relative w-full aspect-video bg-gray-900">
                            <video
                              src={attachment.fileUrl}
                              className="w-full h-full object-cover"
                              controls={false}
                              preload="metadata"
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="bg-white/90 hover:bg-white"
                                onClick={() => window.open(attachment.fileUrl, '_blank', 'noopener,noreferrer')}
                              >
                                <Video className="w-4 h-4 mr-2" />
                                Play Video
                              </Button>
                            </div>
                            <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                              <Video className="w-3 h-3" />
                              Video
                            </div>
                          </div>
                        ) : (
                          <div className="w-full aspect-video bg-gray-100 flex items-center justify-center">
                            <FileText className="w-12 h-12 text-gray-400" />
                          </div>
                        )}
                        <div className="p-3">
                          <p className="text-sm font-medium text-gray-900 truncate mb-1">
                            {attachment.filename}
                          </p>
                          <div className="flex items-center justify-between">
                            <p className="text-xs text-gray-500">
                              {attachment.fileSize ? `${(attachment.fileSize / 1024).toFixed(1)} KB` : 'Unknown size'}
                            </p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs"
                              type="button"
                              onClick={(e) => {
                                e.preventDefault()
                                e.stopPropagation()
                                if (attachment.fileUrl) {
                                  // Open all files (including images) in a new tab
                                  window.open(attachment.fileUrl, '_blank', 'noopener,noreferrer')
                                }
                              }}
                            >
                              <ExternalLink className="w-3 h-3 mr-1" />
                              View
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}


          {/* Description Section */}
          {ticketData.description && (
            <Card className="border border-gray-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Description</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm whitespace-pre-wrap text-gray-700">{ticketData.description}</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Comments/Replies Section */}
          {ticketData.comments && ticketData.comments.length > 0 && (
            <Card className="border border-gray-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Replies ({ticketData.comments.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {ticketData.comments.map((comment: any) => (
                    <div 
                      key={comment.id}
                      className={`p-4 rounded-lg ${
                        comment.isInternal 
                          ? 'bg-yellow-50 border border-yellow-200' 
                          : 'bg-blue-50 border border-blue-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                          <User className="h-3 w-3 text-primary" />
                        </div>
                        <span className="text-sm font-medium">
                          {comment.User?.name || comment.User?.email || 'Agent'}
                        </span>
                        {comment.isInternal && (
                          <Badge variant="outline" className="text-xs">
                            🔒 Internal
                          </Badge>
                        )}
                        <span className="text-xs text-gray-500">
                          {formatDate(comment.createdAt)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap text-gray-700">{comment.content}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}


          {!(ticketData.source === 'FACEBOOK_POST' || ticketData.source === 'FACEBOOK_COMMENT' || ticketData.source === 'FACEBOOK_MESSAGE') && (
            <Card className="border border-gray-200 sticky bottom-0">
              <CardContent className="p-4">
                {/* Only show tabs for agents/admins */}
                {viewMode === 'agent' && (
                <div className="flex gap-2 mb-3 border-b border-gray-200">
                    <Button 
                      type="button"
                      variant="ghost" 
                      size="sm" 
                      className={`rounded-none border-b-2 ${!isInternal ? 'border-primary text-primary' : 'border-transparent text-gray-600'}`}
                      onClick={() => setIsInternal(false)}
                    >
                    Reply
                  </Button>
                    <Button 
                      type="button"
                      variant="ghost" 
                      size="sm" 
                      className={`rounded-none border-b-2 ${isInternal ? 'border-primary text-primary' : 'border-transparent text-gray-600'}`}
                      onClick={() => setIsInternal(true)}
                    >
                    Internal Note
                  </Button>
                </div>
                )}
                <form onSubmit={handleCommentSubmit} className="space-y-3">
                <Textarea
                  placeholder={
                    viewMode === 'agent' 
                      ? (isInternal ? 'Type your internal note...' : 'Type your reply...')
                      : 'Type your reply...'
                  }
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  disabled={isLoading}
                  className="resize-none"
                />
                {/* Attachments Preview */}
                {attachments.length > 0 && (
                  <div className="flex flex-wrap gap-2 mb-2">
                    {attachments.map((file, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 bg-gray-100 px-2 py-1 rounded text-xs"
                      >
                        <Paperclip className="h-3 w-3 text-gray-500" />
                        <span className="max-w-[150px] truncate">{file.name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(index)}
                          className="text-gray-500 hover:text-red-500"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <input
                      type="file"
                      ref={fileInputRef}
                      onChange={handleFileSelect}
                      multiple
                      className="hidden"
                      accept="image/*,application/pdf,.doc,.docx,.txt"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={attachments.length >= 5}
                    >
                      <Paperclip className="h-4 w-4 mr-1 text-blue-600" />
                      Attach
                    </Button>
                    <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" size="sm">
                          <Smile className="h-4 w-4 mr-1 text-yellow-500" />
                          Emoji
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80">
                        <div className="grid grid-cols-8 gap-2">
                          {['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '💩', '👻', '💀', '☠️', '👽', '👾', '🤖', '🎃', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'].map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={() => handleEmojiSelect(emoji)}
                              className="text-2xl hover:bg-gray-100 p-2 rounded transition-colors"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <Popover open={showMacroPicker} onOpenChange={setShowMacroPicker}>
                      <PopoverTrigger asChild>
                        <Button type="button" variant="ghost" size="sm">
                          <FileText className="h-4 w-4 mr-1 text-green-600" />
                          Macro
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80">
                        <div className="space-y-2">
                          <h4 className="font-semibold text-sm mb-3">Quick Responses</h4>
                          {[
                            { name: 'Thank you', text: 'Thank you for contacting us. We appreciate your patience.' },
                            { name: 'Investigating', text: 'We are currently investigating this issue and will update you shortly.' },
                            { name: 'Resolved', text: 'This issue has been resolved. Please let us know if you need any further assistance.' },
                            { name: 'Follow up', text: 'We wanted to follow up on your ticket. Is everything working as expected now?' },
                            { name: 'More info', text: 'To help us assist you better, could you please provide more details about this issue?' },
                          ].map((macro, index) => (
                            <button
                              key={index}
                              type="button"
                              onClick={() => handleMacroSelect(macro.text + '\n\n')}
                              className="w-full text-left p-2 hover:bg-gray-100 rounded text-sm"
                            >
                              <div className="font-medium">{macro.name}</div>
                              <div className="text-xs text-gray-500 truncate">{macro.text}</div>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      type="button" 
                      variant="outline" 
                      size="sm" 
                      disabled={isLoading}
                      onClick={() => {
                        setComment('')
                        setIsInternal(false)
                        setAttachments([])
                      }}
                    >
                      Cancel
                    </Button>
                    <Button type="submit" size="sm" disabled={isLoading || !comment.trim()}>
                      {isInternal ? 'Send Internal Note' : 'Send Reply'} →
                    </Button>
                  </div>
                </div>
              </form>
            </CardContent>
          </Card>
          )}

          {/* Show message for Facebook tickets */}
          {(ticketData.source === 'FACEBOOK_POST' || ticketData.source === 'FACEBOOK_COMMENT' || ticketData.source === 'FACEBOOK_MESSAGE') && (
            <Card className="border border-blue-200 bg-blue-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Facebook className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium text-blue-900 mb-1">Reply on Facebook</p>
                    <p className="text-sm text-blue-700">
                      To reply to this customer, please use the &quot;View on Facebook&quot; button above to open the original post/comment on Facebook and reply there.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Call Confirmation Dialog */}
        <AlertDialog open={showCallDialog} onOpenChange={setShowCallDialog}>
          <AlertDialogContent className="sm:max-w-[425px]">
            <AlertDialogHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                  <Phone className="w-6 h-6 text-blue-600" />
                </div>
                <AlertDialogTitle className="text-xl">Initiate Call</AlertDialogTitle>
              </div>
              <AlertDialogDescription className="text-base pt-2 space-y-3">
                <div>
                  <p className="font-medium text-gray-900 mb-1">Ticket Number:</p>
                  <p className="text-gray-700 font-mono">
                    {ticketData.ticketNumber || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-1">Customer:</p>
                  <p className="text-gray-700">
                    {ticketData.customer?.name || (ticketData.customer?.email ? maskEmail(ticketData.customer.email) : 'Unknown')}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-gray-900 mb-1">Ticket Subject:</p>
                  <p className="text-gray-700">
                    {ticketData.subject || 'No subject'}
                  </p>
                </div>
                {ticketData.customer?.phone && (
                  <div>
                    <p className="font-medium text-gray-900 mb-1">Phone Number:</p>
                    <p className="text-gray-700">
                      {maskPhoneNumber(ticketData.customer.phone)}
                    </p>
                  </div>
                )}
                <p className="text-sm text-gray-500 mt-3 pt-3 border-t border-gray-200">
                  Are you sure you want to initiate a call to this customer?
                </p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0">
              <AlertDialogCancel disabled={isCalling}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={initiateCall}
                disabled={isCalling}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                {isCalling ? (
                  <>
                    <Phone className="h-4 w-4 mr-2 animate-pulse" />
                    Calling...
                  </>
                ) : (
                  <>
                    <Phone className="h-4 w-4 mr-2" />
                    Initiate Call
                  </>
                )}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle className="text-2xl">{ticketData.subject || 'No subject'}</CardTitle>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <Badge>{ticketData.ticketNumber}</Badge>
                  <Badge>{ticketData.status}</Badge>
                  <Badge variant="outline">{ticketData.priority}</Badge>
                  {/* Facebook Link Button */}
                  {(ticketData.source === 'FACEBOOK_POST' || ticketData.source === 'FACEBOOK_COMMENT' || ticketData.source === 'FACEBOOK_MESSAGE') && 
                   (ticketData.facebookPostUrl || (ticketData.FacebookNotification && ticketData.FacebookNotification.length > 0 && ticketData.FacebookNotification[0]?.postUrl)) && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs border-blue-300 text-blue-700 hover:bg-blue-50"
                      onClick={() => {
                        const fbUrl = ticketData.facebookPostUrl || (ticketData.FacebookNotification && ticketData.FacebookNotification[0]?.postUrl)
                        if (fbUrl) {
                          window.open(fbUrl, '_blank', 'noopener,noreferrer')
                        }
                      }}
                    >
                      <Facebook className="w-3.5 h-3.5 mr-1.5" />
                      View on Facebook
                      <ExternalLink className="w-3 h-3 ml-1.5" />
                    </Button>
                  )}
                </div>
              </div>
              {viewMode === 'agent' && (
                <Select
                  value={ticketData.status}
                  onValueChange={handleStatusChange}
                >
                  <SelectTrigger className="w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NEW">New</SelectItem>
                    <SelectItem value="OPEN">Open</SelectItem>
                    <SelectItem value="IN_PROGRESS">In Progress</SelectItem>
                    <SelectItem value="PENDING">Pending</SelectItem>
                    <SelectItem value="RESOLVED">Resolved</SelectItem>
                    <SelectItem value="INITIATE_REFUND">Initiate Refund</SelectItem>
                    <SelectItem value="CLOSED">Closed</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="prose max-w-none">
              <p className="whitespace-pre-wrap">{ticketData.description}</p>
            </div>
          </CardContent>
        </Card>

        {/* Ticket Attachments */}
        {ticketData.attachments && ticketData.attachments.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Paperclip className="w-5 h-5" />
                Attachments ({ticketData.attachments.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {ticketData.attachments.map((attachment: any) => {
                  const attachmentIsImage = isImage(attachment.mimeType, attachment.filename)
                  const attachmentIsVideo = isVideo(attachment.mimeType, attachment.filename)
                  
                  return (
                    <div
                      key={attachment.id}
                      className="border border-gray-200 rounded-lg overflow-hidden bg-white hover:shadow-md transition-shadow"
                    >
                      {attachmentIsImage && attachment.fileUrl ? (
                        <div className="relative w-full aspect-video bg-gray-100">
                          {imageLoadErrors.has(attachment.id) ? (
                            <div className="w-full h-full flex items-center justify-center bg-gray-100">
                              <ImageIcon className="w-8 h-8 text-gray-400" />
                            </div>
                          ) : (
                            <img
                              src={attachment.fileUrl}
                              alt={attachment.filename}
                              className="w-full h-full object-cover cursor-pointer"
                              onClick={() => window.open(attachment.fileUrl, '_blank', 'noopener,noreferrer')}
                              onError={() => {
                                setImageLoadErrors(prev => new Set(prev).add(attachment.id))
                              }}
                            />
                          )}
                          <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                            <ImageIcon className="w-3 h-3" />
                            Image
                          </div>
                        </div>
                      ) : attachmentIsVideo && attachment.fileUrl ? (
                        <div className="relative w-full aspect-video bg-gray-900">
                          <video
                            src={attachment.fileUrl}
                            className="w-full h-full object-cover"
                            controls={false}
                            preload="metadata"
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="bg-white/90 hover:bg-white"
                              onClick={() => window.open(attachment.fileUrl, '_blank', 'noopener,noreferrer')}
                            >
                              <Video className="w-4 h-4 mr-2" />
                              Play Video
                            </Button>
                          </div>
                          <div className="absolute top-2 right-2 bg-black/50 text-white text-xs px-2 py-1 rounded flex items-center gap-1">
                            <Video className="w-3 h-3" />
                            Video
                          </div>
                        </div>
                      ) : (
                        <div className="w-full aspect-video bg-gray-100 flex items-center justify-center">
                          <FileText className="w-12 h-12 text-gray-400" />
                        </div>
                      )}
                      <div className="p-3">
                        <p className="text-sm font-medium text-gray-900 truncate mb-1">
                          {attachment.filename}
                        </p>
                        <div className="flex items-center justify-between">
                          <p className="text-xs text-gray-500">
                            {attachment.fileSize ? `${(attachment.fileSize / 1024).toFixed(1)} KB` : 'Unknown size'}
                          </p>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs"
                            onClick={() => {
                              if (attachment.fileUrl) {
                                window.open(attachment.fileUrl, '_blank', 'noopener,noreferrer')
                              }
                            }}
                          >
                            <ExternalLink className="w-3 h-3 mr-1" />
                            View
                          </Button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Conversation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Ticket Description as First Message */}
            {ticketData.description && (
              <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-sm">
                        {ticketData.customer?.name || (ticketData.customer?.email ? maskEmail(ticketData.customer.email) : 'Customer')}
                      </span>
                      <span className="text-xs text-gray-500">
                        {formatDate(ticketData.createdAt)}
                      </span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{ticketData.description}</p>
                  </div>
                </div>
              </div>
            )}
            {(ticketData.comments || []).map((comment: any) => (
              <div
                key={comment.id}
                className={`p-4 rounded-lg ${
                  comment.isInternal
                    ? 'bg-yellow-50 border border-yellow-200'
                    : comment.User?.role === 'CUSTOMER'
                    ? 'bg-blue-50'
                    : 'bg-gray-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">
                        {comment.User?.name || comment.User?.email}
                      </span>
                      {comment.isInternal && (
                        <Badge variant="outline" className="text-xs">
                          Internal
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {formatDate(comment.createdAt)}
                      </span>
                    </div>
                    <p className="whitespace-pre-wrap">{comment.content}</p>
                    {/* Comment Attachments */}
                    {comment.attachments && comment.attachments.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {comment.attachments.map((attachment: any) => (
                          <div
                            key={attachment.id}
                            className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-200"
                          >
                            <Paperclip className="w-4 h-4 text-gray-500 flex-shrink-0" />
                            <span className="text-xs text-gray-700 truncate flex-1">
                              {attachment.filename}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-xs flex-shrink-0"
                              onClick={() => {
                                if (attachment.fileUrl) {
                                  window.open(attachment.fileUrl, '_blank', 'noopener,noreferrer')
                                }
                              }}
                            >
                              <ExternalLink className="w-3 h-3 mr-1" />
                              View
                            </Button>
                  </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}

            {/* Hide reply form for Facebook tickets */}
            {!(ticketData.source === 'FACEBOOK_POST' || ticketData.source === 'FACEBOOK_COMMENT' || ticketData.source === 'FACEBOOK_MESSAGE') && (
              <form onSubmit={handleCommentSubmit} className="space-y-4">
                <Textarea
                  placeholder={
                    viewMode === 'agent' 
                      ? (isInternal ? 'Type your internal note...' : 'Reply to customer...')
                      : 'Add a comment...'
                  }
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  rows={4}
                  disabled={isLoading}
                />
                {viewMode === 'agent' && (
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="internal-checkbox-2"
                      checked={isInternal}
                      onChange={(e) => setIsInternal(e.target.checked)}
                      className="rounded"
                    />
                    <label htmlFor="internal-checkbox-2" className="text-sm">
                      Internal note (not visible to customer)
                    </label>
                  </div>
                )}
                <Button type="submit" disabled={isLoading || !comment.trim()}>
                  <Send className="mr-2 h-4 w-4" />
                  {isLoading 
                    ? 'Sending...' 
                    : isInternal 
                      ? 'Send Internal Note' 
                      : 'Send Reply'
                  }
                </Button>
              </form>
            )}

            {/* Show message for Facebook tickets */}
            {(ticketData.source === 'FACEBOOK_POST' || ticketData.source === 'FACEBOOK_COMMENT' || ticketData.source === 'FACEBOOK_MESSAGE') && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
                <div className="flex items-start gap-2">
                  <Facebook className="w-5 h-5 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-medium mb-1">Reply on Facebook</p>
                    <p className="text-blue-700">
                      To reply to this customer, please use the &quot;View on Facebook&quot; button above to open the original post/comment on Facebook and reply there.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        {viewMode === 'customer' &&
          (ticketData.status === 'RESOLVED' || ticketData.status === 'CLOSED') && (
            <SatisfactionRating
              ticketId={ticketData.id}
              existingRating={ticketData.satisfactionRating}
              onRatingSubmitted={() => {
                // Refresh ticket data
                window.location.reload()
              }}
            />
          )}
        {viewMode === 'agent' && customerTickets && (
          <Card>
            <CardHeader>
              <CardTitle>Customer History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {customerTickets.map((t) => (
                  <Link
                    key={t.id}
                    href={`/agent/tickets/${t.id}`}
                    className="block p-2 rounded hover:bg-gray-50"
                  >
                    <div className="text-sm font-medium">{t.ticketNumber}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {t.subject}
                    </div>
                    <Badge className="text-xs mt-1">{t.status}</Badge>
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Ticket Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="text-sm text-muted-foreground">Customer</div>
              <div className="font-medium">
                {ticketData.customer.name || maskEmail(ticketData.customer.email)}
              </div>
              {ticketData.customer.phone && (
                <div className="mt-2 flex items-center gap-2">
                  <Phone className="h-4 w-4 text-gray-400" />
                  <span className="text-sm text-gray-600">
                    {maskPhoneNumber(ticketData.customer.phone)}
                  </span>
                  {viewMode === 'agent' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCall}
                      disabled={isCalling}
                      className="h-7 text-xs ml-auto"
                    >
                      <Phone className="h-3.5 w-3.5 mr-1.5" />
                      {isCalling ? 'Calling...' : 'Call'}
                    </Button>
                  )}
                </div>
              )}
              {viewMode === 'agent' && currentUserPhone && (
                <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-blue-600" />
                    <span className="text-xs text-blue-700">
                      <span className="font-medium">Your number for calling:</span> {currentUserPhone}
                    </span>
                  </div>
                </div>
              )}
            </div>
            {ticketData.assignedAgent && (
              <div>
                <div className="text-sm text-muted-foreground">Assigned Agent</div>
                <div className="font-medium">
                  {ticketData.assignedAgent.name || ticketData.assignedAgent.email}
                </div>
              </div>
            )}
            {ticketData.category && (
              <div>
                <div className="text-sm text-muted-foreground">Category</div>
                <div className="font-medium">{ticketData.category.name}</div>
              </div>
            )}
            <div>
              <div className="text-sm text-muted-foreground">Created</div>
              <div className="font-medium">{formatDate(ticketData.createdAt)}</div>
            </div>
            {ticketData.resolvedAt && (
              <div>
                <div className="text-sm text-muted-foreground">Resolved</div>
                <div className="font-medium">{formatDate(ticketData.resolvedAt)}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Call Confirmation Dialog */}
      <AlertDialog open={showCallDialog} onOpenChange={setShowCallDialog}>
        <AlertDialogContent className="sm:max-w-[425px]">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                <Phone className="w-6 h-6 text-blue-600" />
              </div>
              <AlertDialogTitle className="text-xl">Initiate Call</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-base pt-2 space-y-3">
              <div>
                <p className="font-medium text-gray-900 mb-1">Ticket Number:</p>
                <p className="text-gray-700 font-mono">
                  {ticketData.ticketNumber || 'N/A'}
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-900 mb-1">Customer:</p>
                <p className="text-gray-700">
                  {ticketData.customer?.name || (ticketData.customer?.email ? maskEmail(ticketData.customer.email) : 'Unknown')}
                </p>
              </div>
              <div>
                <p className="font-medium text-gray-900 mb-1">Ticket Subject:</p>
                <p className="text-gray-700">
                  {ticketData.subject || 'No subject'}
                </p>
              </div>
              {ticketData.customer?.phone && (
                <div>
                  <p className="font-medium text-gray-900 mb-1">Phone Number:</p>
                  <p className="text-gray-700">
                    {maskPhoneNumber(ticketData.customer.phone)}
                  </p>
                </div>
              )}
              <p className="text-sm text-gray-500 mt-3 pt-3 border-t border-gray-200">
                Are you sure you want to initiate a call to this customer?
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={isCalling}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={initiateCall}
              disabled={isCalling}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isCalling ? (
                <>
                  <Phone className="h-4 w-4 mr-2 animate-pulse" />
                  Calling...
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4 mr-2" />
                  Initiate Call
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Image View Modal */}
      {selectedImage && (
        <Dialog 
          open={true} 
          onOpenChange={(open) => {
            console.log('Dialog onOpenChange called with:', open, 'selectedImage:', selectedImage)
            if (!open) {
              setSelectedImage(null)
            }
          }}
        >
          <DialogContent 
            className="!max-w-[95vw] !w-[95vw] !h-[95vh] !p-0 !bg-black/95 !border-none !overflow-hidden !flex !flex-col !gap-0 [&>button]:hidden !z-[100]"
            onPointerDownOutside={(e) => {
              e.preventDefault()
              setSelectedImage(null)
            }}
            onEscapeKeyDown={() => {
              setSelectedImage(null)
            }}
          >
            <DialogHeader className="sr-only">
              <DialogTitle>Image Viewer</DialogTitle>
              <DialogDescription>{selectedImage.filename}</DialogDescription>
            </DialogHeader>
            <div className="relative w-full h-full flex items-center justify-center p-4" style={{ flex: 1, minHeight: 0 }}>
              <img
                src={selectedImage.url}
                alt={selectedImage.filename}
                className="max-w-full max-h-full object-contain"
                onClick={(e) => e.stopPropagation()}
                onError={() => {
                  console.error('Failed to load image in modal:', selectedImage.url)
                }}
              />
              <Button
                variant="ghost"
                size="icon"
                className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white z-[101] rounded-full"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  console.log('Close button clicked')
                  setSelectedImage(null)
                }}
              >
                <X className="w-5 h-5" />
              </Button>
              <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 bg-black/70 text-white px-4 py-2 rounded text-sm max-w-[80%] truncate z-[101]">
                {selectedImage.filename}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

