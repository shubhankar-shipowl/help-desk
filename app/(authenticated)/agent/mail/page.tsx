'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useStore } from '@/lib/store-context'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Mail, MailOpen, Clock, User, FileText, Loader2, AlertCircle, RefreshCw, Download, ChevronDown, ChevronUp, Calendar, AtSign, Trash2, CheckSquare, Square, AlertTriangle } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { useToast } from '@/components/ui/use-toast'

interface Email {
  id: string
  fromEmail: string
  fromName: string | null
  toEmail: string
  subject: string
  textContent: string | null
  htmlContent: string | null
  read: boolean
  readAt: Date | null
  createdAt: Date
  ticketId: string | null
  ticket: {
    id: string
    ticketNumber: string
    subject: string
    status: string
  } | null
}

export default function MailPage() {
  const { data: session } = useSession()
  const { selectedStoreId, loading: storeLoading } = useStore()
  const { toast } = useToast()
  const [emails, setEmails] = useState<Email[]>([])
  const [loading, setLoading] = useState(true)
  const [fetching, setFetching] = useState(false)
  const [unreadCount, setUnreadCount] = useState(0)
  const [totalCount, setTotalCount] = useState(0) // Total count of all emails
  const [readCount, setReadCount] = useState(0) // Count of read emails
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')
  const [expandedEmailId, setExpandedEmailId] = useState<string | null>(null)
  const [selectedEmails, setSelectedEmails] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean
    type: 'selected' | 'all'
    count: number
  }>({ open: false, type: 'selected', count: 0 })

  // Fetch emails from database when filter or store changes
  useEffect(() => {
    if (!storeLoading) {
      fetchEmails()
    }
  }, [filter, selectedStoreId, storeLoading])

  const fetchEmails = async () => {
    // For admins, require store selection
    if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.append('limit', '50') // Show 50 latest emails
      
      if (filter === 'unread') {
        params.append('read', 'false')
      } else if (filter === 'read') {
        params.append('read', 'true')
      }
      // For 'all' filter, don't add read parameter - show all emails

      if (selectedStoreId) {
        params.append('storeId', selectedStoreId)
      }

      const response = await fetch(`/api/emails?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch emails')
      }

      setEmails(data.emails || [])
      setUnreadCount(data.unreadCount || 0)
      setTotalCount(data.totalAll || data.total || 0) // Use totalAll for "All" count
      setReadCount(data.readCount || 0)
    } catch (error: any) {
      console.error('Error fetching emails:', error)
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (emailId: string) => {
    try {
      await fetch(`/api/emails/${emailId}`, { method: 'PATCH' })
      setEmails((prev) =>
        prev.map((email) =>
          email.id === emailId ? { ...email, read: true, readAt: new Date() } : email
        )
      )
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch (error) {
      console.error('Error marking email as read:', error)
    }
  }

  const fetchFromGmail = async (mode: 'unread' | 'latest' = 'unread', limit?: number, silent = false) => {
    if (!selectedStoreId && session?.user?.role === 'ADMIN') {
      if (!silent) {
        toast({
          title: 'Error',
          description: 'Please select a store to fetch emails',
          variant: 'destructive',
        })
      }
      return
    }

    setFetching(true)
    try {
      const response = await fetch('/api/emails/fetch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storeId: selectedStoreId,
          mode,
          limit,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch emails from Gmail')
      }

      if (!silent) {
        toast({
          title: 'Success',
          description: data.message || `Fetched ${data.stats?.fetched || 0} emails, stored ${data.stats?.stored || 0} new emails`,
        })
      }

      // Refresh email list after fetching (with small delay to ensure emails are stored)
      setTimeout(() => {
        fetchEmails()
      }, 500)
    } catch (error: any) {
      console.error('Error fetching emails from Gmail:', error)
      if (!silent) {
        toast({
          title: 'Error',
          description: error.message || 'Failed to fetch emails from Gmail',
          variant: 'destructive',
        })
      }
    } finally {
      setFetching(false)
    }
  }

  const getEmailPreview = (email: Email) => {
    if (email.htmlContent) {
      // Strip HTML tags for preview
      const text = email.htmlContent.replace(/<[^>]*>/g, '').trim()
      return text.substring(0, 150) + (text.length > 150 ? '...' : '')
    }
    return email.textContent?.substring(0, 150) || 'No content'
  }

  const toggleEmailExpansion = (emailId: string) => {
    setExpandedEmailId(expandedEmailId === emailId ? null : emailId)
  }

  const getEmailContent = (email: Email) => {
    // Prefer HTML content if available, otherwise use text content
    if (email.htmlContent) {
      return email.htmlContent
    }
    return email.textContent || 'No content available'
  }

  const toggleEmailSelection = (emailId: string) => {
    setSelectedEmails((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(emailId)) {
        newSet.delete(emailId)
      } else {
        newSet.add(emailId)
      }
      return newSet
    })
  }

  const toggleSelectAll = () => {
    if (selectedEmails.size === emails.length) {
      setSelectedEmails(new Set())
    } else {
      setSelectedEmails(new Set(emails.map((e) => e.id)))
    }
  }

  const deleteSelectedEmails = async () => {
    if (selectedEmails.size === 0) {
      toast({
        title: 'No emails selected',
        description: 'Please select emails to delete',
        variant: 'destructive',
      })
      return
    }

    setDeleteDialog({
      open: true,
      type: 'selected',
      count: selectedEmails.size,
    })
  }

  const confirmDeleteSelected = async () => {
    setDeleteDialog({ open: false, type: 'selected', count: 0 })
    setDeleting(true)
    try {
      const response = await fetch('/api/emails/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          emailIds: Array.from(selectedEmails),
          storeId: selectedStoreId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete emails')
      }

      toast({
        title: 'Success',
        description: data.message || `Deleted ${data.deletedCount} email(s)`,
      })

      setSelectedEmails(new Set())
      fetchEmails()
    } catch (error: any) {
      console.error('Error deleting emails:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete emails',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  const deleteAllEmails = async () => {
    if (totalCount === 0) {
      toast({
        title: 'No emails to delete',
        description: 'There are no emails to delete',
        variant: 'destructive',
      })
      return
    }

    setDeleteDialog({
      open: true,
      type: 'all',
      count: totalCount, // Use totalCount instead of emails.length to show all emails count
    })
  }

  const confirmDeleteAll = async () => {
    setDeleteDialog({ open: false, type: 'all', count: 0 })
    setDeleting(true)
    try {
      const response = await fetch('/api/emails/delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deleteAll: true,
          storeId: selectedStoreId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete emails')
      }

      toast({
        title: 'Success',
        description: data.message || `Deleted ${data.deletedCount} email(s)`,
      })

      setSelectedEmails(new Set())
      fetchEmails()
    } catch (error: any) {
      console.error('Error deleting all emails:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete emails',
        variant: 'destructive',
      })
    } finally {
      setDeleting(false)
    }
  }

  if (storeLoading || loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-h1 mb-2">Mail</h1>
          <p className="text-gray-600">View and manage all incoming emails</p>
        </div>
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">Please select a store to view emails</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h1 mb-2">Mail</h1>
            <p className="text-gray-600">View and manage all incoming emails</p>
          </div>
          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <Badge 
                variant="destructive" 
                className="text-sm font-semibold px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white border-0"
              >
                {unreadCount} unread
              </Badge>
            )}
            {selectedEmails.size > 0 && (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={deleteSelectedEmails}
                  disabled={deleting}
                  className="gap-2 bg-red-600 hover:bg-red-700 text-white font-medium shadow-sm"
                >
                  {deleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  {deleting ? 'Deleting...' : `Delete Selected (${selectedEmails.size})`}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedEmails(new Set())}
                  disabled={deleting}
                  className="font-medium border-gray-300 hover:bg-gray-50"
                >
                  Cancel
                </Button>
              </>
            )}
            {selectedEmails.size === 0 && (
              <>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={deleteAllEmails}
                  disabled={deleting || emails.length === 0}
                  className="gap-2 bg-red-600 hover:bg-red-700 text-white font-medium shadow-sm"
                >
                  {deleting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                  {deleting ? 'Deleting...' : 'Delete All'}
                </Button>
                <div className="h-6 w-px bg-gray-300 mx-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchFromGmail('unread')}
                  disabled={fetching || !selectedStoreId}
                  className="gap-2 font-medium border-gray-300 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
                >
                  {fetching ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  {fetching ? 'Fetching...' : 'Fetch Unread'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchFromGmail('latest')}
                  disabled={fetching || !selectedStoreId}
                  className="gap-2 font-medium border-gray-300 hover:bg-blue-50 hover:border-blue-300 hover:text-blue-700 transition-colors"
                >
                  {fetching ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4" />
                  )}
                  {fetching ? 'Fetching...' : 'Fetch Latest'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mb-6 flex gap-2">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          All ({totalCount})
        </Button>
        <Button
          variant={filter === 'unread' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('unread')}
        >
          Unread ({unreadCount})
        </Button>
        <Button
          variant={filter === 'read' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('read')}
        >
          Read ({readCount})
        </Button>
      </div>

      {/* Email List */}
      {emails.length === 0 ? (
        <Card>
          <CardContent className="py-12">
            <div className="text-center">
              <Mail className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">
                {filter === 'unread' ? 'No unread emails' : 'No emails found'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Select All Checkbox */}
          {emails.length > 0 && (
            <div className="flex items-center gap-2 pb-2 border-b border-gray-200">
              <Button
                variant="ghost"
                size="sm"
                onClick={toggleSelectAll}
                className="gap-2 h-8"
              >
                {selectedEmails.size === emails.length ? (
                  <CheckSquare className="w-4 h-4 text-primary" />
                ) : (
                  <Square className="w-4 h-4 text-gray-400" />
                )}
                <span className="text-sm text-gray-600">
                  {selectedEmails.size === emails.length ? 'Deselect All' : 'Select All'}
                </span>
              </Button>
              {selectedEmails.size > 0 && (
                <span className="text-sm text-gray-500">
                  {selectedEmails.size} of {emails.length} selected
                </span>
              )}
            </div>
          )}
          
          {emails.map((email) => {
            const isExpanded = expandedEmailId === email.id
            const isSelected = selectedEmails.has(email.id)
            return (
              <Card
                key={email.id}
                className={`transition-all hover:shadow-md ${
                  !email.read ? 'border-l-4 border-l-blue-500 bg-blue-50/50' : ''
                } ${isSelected ? 'ring-2 ring-primary ring-offset-2' : ''}`}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 flex items-start gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleEmailSelection(email.id)
                        }}
                        className="mt-1"
                      >
                        {isSelected ? (
                          <CheckSquare className="w-5 h-5 text-primary" />
                        ) : (
                          <Square className="w-5 h-5 text-gray-400 hover:text-gray-600" />
                        )}
                      </button>
                      {email.read ? (
                        <MailOpen className="w-5 h-5 text-gray-400 mt-1" />
                      ) : (
                        <Mail className="w-5 h-5 text-blue-600 mt-1" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-semibold text-gray-900 truncate">
                              {email.fromName || email.fromEmail}
                            </span>
                            {!email.read && (
                              <Badge variant="default" className="text-xs">
                                New
                              </Badge>
                            )}
                            {email.ticket && (
                              <Badge variant="outline" className="text-xs">
                                {email.ticket.ticketNumber}
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm font-medium text-gray-900 truncate">
                            {email.subject}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-shrink-0 text-xs text-gray-500" title={format(new Date(email.createdAt), 'PPpp')}>
                            {format(new Date(email.createdAt), 'MMM d, yyyy h:mm a')}
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                              e.stopPropagation()
                              toggleEmailExpansion(email.id)
                            }}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-4 h-4" />
                            ) : (
                              <ChevronDown className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      </div>
                      {!isExpanded ? (
                        <p className="text-sm text-gray-600 line-clamp-2">
                          {getEmailPreview(email)}
                        </p>
                      ) : (
                        <div className="mt-4 space-y-4">
                          {/* Email Header */}
                          <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                            <div className="space-y-3">
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 mt-0.5">
                                  <User className="w-4 h-4 text-gray-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-gray-500 mb-1">From</div>
                                  <div className="text-sm font-medium text-gray-900">
                                    {email.fromName && (
                                      <span className="block">{email.fromName}</span>
                                    )}
                                    <span className="text-gray-600">{email.fromEmail}</span>
                                  </div>
                                </div>
                              </div>
                              
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 mt-0.5">
                                  <AtSign className="w-4 h-4 text-gray-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-gray-500 mb-1">To</div>
                                  <div className="text-sm text-gray-900">{email.toEmail}</div>
                                </div>
                              </div>
                              
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 mt-0.5">
                                  <Calendar className="w-4 h-4 text-gray-500" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="text-xs text-gray-500 mb-1">Date</div>
                                  <div className="text-sm text-gray-900">
                                    {format(new Date(email.createdAt), 'EEEE, MMMM d, yyyy')}
                                  </div>
                                  <div className="text-xs text-gray-500 mt-0.5">
                                    {format(new Date(email.createdAt), 'h:mm a')}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Email Subject */}
                          <div className="border-b border-gray-200 pb-3">
                            <div className="text-xs text-gray-500 mb-1">Subject</div>
                            <div className="text-base font-semibold text-gray-900">{email.subject}</div>
                          </div>

                          {/* Email Body */}
                          <div className="bg-white rounded-lg border border-gray-200 p-6 min-h-[200px]">
                            {email.htmlContent ? (
                              <div
                                className="prose prose-sm max-w-none text-gray-700 email-content"
                                dangerouslySetInnerHTML={{ __html: email.htmlContent }}
                                style={{
                                  fontFamily: 'system-ui, -apple-system, sans-serif',
                                  lineHeight: '1.6',
                                }}
                              />
                            ) : (
                              <div 
                                className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed"
                                style={{
                                  fontFamily: 'system-ui, -apple-system, sans-serif',
                                  lineHeight: '1.8',
                                }}
                              >
                                {email.textContent || 'No content available'}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {email.ticket && (
                        <div className="mt-2 flex items-center gap-2 text-xs text-gray-500">
                          <FileText className="w-3 h-3" />
                          <span>Linked to ticket: {email.ticket.ticketNumber}</span>
                        </div>
                      )}
                      {!email.read && (
                        <div className={isExpanded ? "mt-4 pt-4 border-t border-gray-200" : "mt-3"}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              markAsRead(email.id)
                            }}
                          >
                            Mark as Read
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => setDeleteDialog({ ...deleteDialog, open })}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <DialogTitle className="text-xl font-semibold text-gray-900">
                Confirm Deletion
              </DialogTitle>
            </div>
            <DialogDescription className="text-base text-gray-600 pt-2">
              {deleteDialog.type === 'all' ? (
                <>
                  Are you sure you want to delete <strong>all {deleteDialog.count} email(s)</strong>?
                  <br />
                  <span className="text-red-600 font-medium mt-2 block">
                    This action cannot be undone.
                  </span>
                </>
              ) : (
                <>
                  Are you sure you want to delete <strong>{deleteDialog.count} selected email(s)</strong>?
                  <br />
                  <span className="text-red-600 font-medium mt-2 block">
                    This action cannot be undone.
                  </span>
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDeleteDialog({ open: false, type: 'selected', count: 0 })}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={deleteDialog.type === 'all' ? confirmDeleteAll : confirmDeleteSelected}
              disabled={deleting}
              className="gap-2"
            >
              {deleting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="w-4 h-4" />
                  Delete {deleteDialog.type === 'all' ? 'All' : 'Selected'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
