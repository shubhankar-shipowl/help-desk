'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useNotificationSocket } from '@/lib/notifications/client'
import { useStore } from '@/lib/store-context'
import { TicketDetail } from './ticket-detail'
import { formatRelativeTime, maskEmail } from '@/lib/utils'
import { TicketStatus, TicketPriority } from '@prisma/client'
import {
  Search, Plus, Filter, MoreVertical, Clock, MessageSquare,
  User, Mail, Phone, Tag, AlertCircle, CheckCircle, XCircle,
  Loader, ArrowRight, Paperclip, Eye, Circle, AlertTriangle, X, Trash2
} from 'lucide-react'
import { cn } from '@/lib/utils'
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
import { useToast } from '@/components/ui/use-toast'

interface Ticket {
  id: string
  ticketNumber: string
  subject: string
  description?: string
  customer: {
    name: string | null
    email: string
    avatar?: string | null
  }
  status: TicketStatus
  priority: TicketPriority
  assignedAgent?: {
    name: string | null
    email: string
    avatar?: string | null
  } | null
  category?: {
    name: string
    color: string | null
  } | null
  createdAt: Date
  updatedAt: Date
  _count: {
    comments: number
    attachments: number
  }
}

interface ModernInboxProps {
  initialTickets: Ticket[]
  stats?: {
    total: number
    open: number
    overdue: number
    facebook: number
  }
  teams?: Array<{ id: string; name: string; color: string | null }>
  categories?: Array<{ id: string; name: string; icon: string | null; color: string | null }>
}

export function ModernInbox({ initialTickets, stats, teams, categories }: ModernInboxProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const socket = useNotificationSocket()
  const { toast } = useToast()
  const { selectedStoreId } = useStore()
  // Start with empty array - we'll fetch fresh data on mount to respect store selection
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null)
  const [loading, setLoading] = useState(false)
  const [view, setView] = useState<'list' | 'kanban'>('list')
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string[]>(['NEW', 'OPEN'])
  const [priorityFilter, setPriorityFilter] = useState<string[]>([])
  const [assignedFilter, setAssignedFilter] = useState<'me' | 'unassigned' | 'all'>('all')
  const [showFilters, setShowFilters] = useState(true)
  const [ticketDetail, setTicketDetail] = useState<any>(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [availableAgents, setAvailableAgents] = useState<Array<{ id: string; name: string | null; email: string }>>([])
  
  // Delete confirmation dialog state
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null)

  // Fetch available agents
  useEffect(() => {
    if (session?.user?.role === 'ADMIN' || session?.user?.role === 'AGENT') {
      const url = selectedStoreId
        ? `/api/users?role=AGENT&storeId=${selectedStoreId}`
        : '/api/users?role=AGENT'
      fetch(url)
        .then(res => res.json())
        .then(data => {
          if (data.users) {
            setAvailableAgents(
              data.users
                .filter((u: any) => u.role === 'AGENT' && u.isActive)
                .map((u: any) => ({
                  id: u.id,
                  name: u.name,
                  email: u.email,
                }))
            )
          }
        })
        .catch(console.error)
    }
  }, [session, selectedStoreId])

  // Listen for ticket updates via WebSocket
  useEffect(() => {
    if (!socket) {
      return
    }

    // Define handlers
    const handleTicketCreated = (data: { ticket: any }) => {
      const { ticket } = data
      
      if (!ticket || !ticket.id) {
        console.error('[ModernInbox] ❌ Invalid ticket data received:', data)
        return
      }
      
      // Check if ticket already exists in the list (avoid duplicates)
      setTickets((prevTickets) => {
        const exists = prevTickets.some((t) => t.id === ticket.id)
        if (exists) {
          return prevTickets.map((t) =>
            t.id === ticket.id
            ? {
                ...t,
                status: ticket.status,
                priority: ticket.priority,
                  assignedAgent: ticket.assignedAgent ? {
                    name: ticket.assignedAgent.name,
                    email: ticket.assignedAgent.email,
                    avatar: ticket.assignedAgent.avatar,
                  } : null,
                  _count: ticket._count || t._count,
                }
              : t
          )
        }
        
        // Transform ticket data to match Ticket interface
        const newTicket: Ticket = {
          id: ticket.id,
          ticketNumber: ticket.ticketNumber || `TKT-${ticket.id}`,
          subject: ticket.subject || 'No subject',
          description: ticket.description,
          customer: ticket.customer ? {
            name: ticket.customer.name,
            email: ticket.customer.email || '',
            avatar: ticket.customer.avatar,
          } : { name: null, email: '' },
          status: ticket.status || 'NEW',
          priority: ticket.priority || 'NORMAL',
          assignedAgent: ticket.assignedAgent ? {
            name: ticket.assignedAgent.name,
            email: ticket.assignedAgent.email,
            avatar: ticket.assignedAgent.avatar,
          } : null,
          category: ticket.category ? {
            name: ticket.category.name,
            color: ticket.category.color,
          } : null,
          createdAt: ticket.createdAt ? new Date(ticket.createdAt) : new Date(),
          updatedAt: ticket.updatedAt ? new Date(ticket.updatedAt) : new Date(),
          _count: ticket._count || { comments: 0, attachments: 0 },
        }
        
        // Add new ticket to the beginning of the list
        const updatedTickets = [newTicket, ...prevTickets]
        
        // Check if ticket will be visible with current filters
        const willShowInFilter = 
          (statusFilter.length === 0 || statusFilter.includes(newTicket.status)) &&
          (assignedFilter === 'all' || 
           (assignedFilter === 'me' && newTicket.assignedAgent?.email === session?.user?.email) ||
           (assignedFilter === 'unassigned' && !newTicket.assignedAgent))
        
        // Show toast notification
        if (newTicket.assignedAgent?.email === session?.user?.email) {
          toast({
            title: 'New Ticket Assigned',
            description: `Ticket ${newTicket.ticketNumber} has been assigned to you`,
            duration: 5000,
          })
        } else if (willShowInFilter) {
          // Show toast for new tickets that will be visible
          toast({
            title: 'New Ticket Created',
            description: `Ticket ${newTicket.ticketNumber} has been created`,
            duration: 3000,
          })
        } else {
          // Show toast if ticket won't be visible due to filters
          toast({
            title: 'New Ticket Created',
            description: `Ticket ${newTicket.ticketNumber} was created. Adjust filters to view it.`,
            duration: 5000,
          })
        }
        
        return updatedTickets
      })
    }

    const handleTicketUpdate = (data: { ticketId: string; ticket: any; changes?: any }) => {
      const { ticketId, ticket, changes } = data
      
      if (!ticket || !ticketId) {
        console.error('[ModernInbox] ❌ Invalid ticket update data:', data)
        return
      }
      
      setTickets((prevTickets) => {
        const existingIndex = prevTickets.findIndex((t) => t.id === ticketId)
        
        // If ticket exists, update it with all fields
        if (existingIndex !== -1) {
          const updatedTickets = prevTickets.map((t) =>
            t.id === ticketId
              ? {
                  ...t,
                  status: ticket.status || t.status,
                  priority: ticket.priority || t.priority,
                  subject: ticket.subject || t.subject,
                  description: ticket.description || t.description,
                assignedAgent: ticket.assignedAgent
                  ? {
                      name: ticket.assignedAgent.name,
                      email: ticket.assignedAgent.email,
                        avatar: ticket.assignedAgent.avatar,
                    }
                    : ticket.assignedAgent === null ? null : t.assignedAgent,
                  category: ticket.category
                    ? {
                        name: ticket.category.name,
                        color: ticket.category.color,
                      }
                    : ticket.category === null ? null : t.category,
                  customer: ticket.customer
                    ? {
                        name: ticket.customer.name,
                        email: ticket.customer.email || t.customer.email,
                        avatar: ticket.customer.avatar,
                      }
                    : t.customer,
                  updatedAt: ticket.updatedAt ? new Date(ticket.updatedAt) : t.updatedAt,
                  _count: ticket._count || t._count,
                }
              : t
          )
          
          // Show toast if status changed
          if (changes?.status && changes.status.from !== changes.status.to) {
            const updatedTicket = updatedTickets.find(t => t.id === ticketId)
            if (updatedTicket) {
              toast({
                title: 'Ticket Status Updated',
                description: `Ticket ${updatedTicket.ticketNumber} status changed to ${updatedTicket.status}`,
                duration: 3000,
              })
            }
          }
          
          return updatedTickets
        }
        
        // If ticket doesn't exist but was assigned to current user, add it
        if (changes?.assignedAgentId?.to && session?.user?.id === changes.assignedAgentId.to) {
          const newTicket: Ticket = {
            id: ticket.id || ticketId,
            ticketNumber: ticket.ticketNumber,
            subject: ticket.subject,
            description: ticket.description,
            customer: ticket.customer ? {
              name: ticket.customer.name,
              email: ticket.customer.email,
              avatar: ticket.customer.avatar,
            } : { name: null, email: '' },
          status: ticket.status,
          priority: ticket.priority,
            assignedAgent: ticket.assignedAgent ? {
              name: ticket.assignedAgent.name,
              email: ticket.assignedAgent.email,
              avatar: ticket.assignedAgent.avatar,
            } : null,
            category: ticket.category ? {
              name: ticket.category.name,
              color: ticket.category.color,
            } : null,
            createdAt: new Date(ticket.createdAt || Date.now()),
            updatedAt: new Date(ticket.updatedAt || Date.now()),
            _count: ticket._count || { comments: 0, attachments: 0 },
          }
          
          toast({
            title: 'Ticket Assigned',
            description: `Ticket ${newTicket.ticketNumber} has been assigned to you`,
            duration: 3000,
          })
          
          return [newTicket, ...prevTickets]
        }
        
        return prevTickets
      })

      // If the updated ticket is currently selected, refresh its details
      if (selectedTicket && selectedTicket.id === ticketId) {
        // Update selected ticket with new data
        const updatedSelectedTicket: Ticket = {
          id: ticket.id || ticketId,
          ticketNumber: ticket.ticketNumber || selectedTicket.ticketNumber,
          subject: ticket.subject || selectedTicket.subject,
          description: ticket.description || selectedTicket.description,
          customer: ticket.customer ? {
            name: ticket.customer.name,
            email: ticket.customer.email,
            avatar: ticket.customer.avatar,
          } : selectedTicket.customer,
          status: ticket.status || selectedTicket.status,
          priority: ticket.priority || selectedTicket.priority,
          assignedAgent: ticket.assignedAgent
            ? {
                name: ticket.assignedAgent.name,
                email: ticket.assignedAgent.email,
                avatar: ticket.assignedAgent.avatar,
              }
            : ticket.assignedAgent === null ? null : selectedTicket.assignedAgent,
          category: ticket.category ? {
            name: ticket.category.name,
            color: ticket.category.color,
          } : ticket.category === null ? null : selectedTicket.category,
          createdAt: ticket.createdAt ? new Date(ticket.createdAt) : selectedTicket.createdAt,
          updatedAt: ticket.updatedAt ? new Date(ticket.updatedAt) : selectedTicket.updatedAt,
          _count: ticket._count || selectedTicket._count,
        }
        setSelectedTicket(updatedSelectedTicket)
        
        // Update ticket detail with full ticket data
        if (ticketDetail && ticketDetail.id === ticketId) {
          setTicketDetail({
            ...ticketDetail,
            status: ticket.status || ticketDetail.status,
            priority: ticket.priority || ticketDetail.priority,
            assignedAgent: ticket.assignedAgent || ticketDetail.assignedAgent,
            assignedAgentId: ticket.assignedAgentId !== undefined ? ticket.assignedAgentId : ticketDetail.assignedAgentId,
            category: ticket.category || ticketDetail.category,
            updatedAt: ticket.updatedAt || ticketDetail.updatedAt,
            _count: ticket._count || ticketDetail._count,
          })
        }
      }
    }

    const handleTicketDelete = (data: { ticketId: string }) => {
      const { ticketId } = data
      
      setTickets((prevTickets) => prevTickets.filter((t) => t.id !== ticketId))
      
      if (selectedTicket && selectedTicket.id === ticketId) {
        setSelectedTicket(null)
        setTicketDetail(null)
        
        // Show toast notification
        toast({
          title: 'Ticket Deleted',
          description: 'This ticket has been deleted and is no longer available.',
          duration: 5000,
        })
      } else {
        // Show toast even if ticket wasn't selected
        toast({
          title: 'Ticket Deleted',
          description: 'A ticket has been removed from your list.',
          duration: 3000,
        })
      }
    }

    // Setup event listeners
    const setupListeners = () => {
      // Remove existing listeners first to avoid duplicates
      socket.off('ticket:created', handleTicketCreated)
      socket.off('ticket:updated', handleTicketUpdate)
      socket.off('ticket:deleted', handleTicketDelete)
      
      // Register event listeners
      socket.on('ticket:created', handleTicketCreated)
    socket.on('ticket:updated', handleTicketUpdate)
    socket.on('ticket:deleted', handleTicketDelete)
    }

    // Setup listeners if already connected
    if (socket.connected) {
      setupListeners()
    }

    // Also listen for connect event in case socket connects later
    const onConnect = () => {
      setupListeners()
    }
    
    const onConnectError = (error: Error) => {
      console.error('[ModernInbox] ❌ WebSocket connection error:', error)
    }

    socket.on('connect', onConnect)
    socket.on('connect_error', onConnectError)

    return () => {
      if (socket) {
        socket.off('connect', onConnect)
        socket.off('connect_error', onConnectError)
        socket.off('ticket:created', handleTicketCreated)
      socket.off('ticket:updated', handleTicketUpdate)
      socket.off('ticket:deleted', handleTicketDelete)
    }
    }
  }, [socket, selectedTicket, session, statusFilter, assignedFilter])

  // Fetch tickets on mount and when filters/store changes
  useEffect(() => {
    fetchTickets()
  }, [statusFilter, priorityFilter, assignedFilter, searchQuery, selectedStoreId])

  const handleDeleteClick = (ticketId: string) => {
    setTicketToDelete(ticketId)
    setDeleteDialogOpen(true)
  }

  async function handleDeleteTicket() {
    if (!ticketToDelete) return

    try {
      const response = await fetch(`/api/tickets/${ticketToDelete}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete ticket')
      }

      // Remove ticket from list
      setTickets((prevTickets) => prevTickets.filter((t) => t.id !== ticketToDelete))
      
      // Close detail panel if deleted ticket was selected
      if (selectedTicket && selectedTicket.id === ticketToDelete) {
        setSelectedTicket(null)
        setTicketDetail(null)
      }

      // Close dialog and show success message
      setDeleteDialogOpen(false)
      setTicketToDelete(null)
      
      toast({
        title: 'Ticket Deleted',
        description: 'The ticket has been successfully deleted.',
      })
    } catch (error: any) {
      console.error('Error deleting ticket:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete ticket',
        variant: 'destructive',
      })
      setDeleteDialogOpen(false)
      setTicketToDelete(null)
    }
  }

  async function fetchTickets() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter.length > 0) params.append('status', statusFilter.join(','))
      if (priorityFilter.length > 0) params.append('priority', priorityFilter.join(','))
      if (assignedFilter !== 'all') {
        if (assignedFilter === 'me' && session?.user?.id) {
          params.append('assignedAgentId', session.user.id)
        } else if (assignedFilter === 'unassigned') {
          params.append('unassigned', 'true')
        }
      }
      if (searchQuery) params.append('search', searchQuery)
      // Add storeId filter if a store is selected
      if (selectedStoreId) {
        params.append('storeId', selectedStoreId)
      }

      const response = await fetch(`/api/tickets?${params.toString()}`)
      const data = await response.json()
      if (data.tickets) {
        // Ensure all tickets have a subject field
        const ticketsWithSubject = data.tickets.map((ticket: any) => ({
          ...ticket,
          subject: ticket.subject || 'No subject',
        }))
        setTickets(ticketsWithSubject)
      }
    } catch (error) {
      console.error('Error fetching tickets:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleTicketSelect = async (ticket: Ticket) => {
    // Safety check: ensure ticket has an ID
    if (!ticket?.id) {
      console.error('Cannot select ticket: missing ID', ticket)
      return
    }
    
    // Clear previous ticket detail when selecting a new ticket
    setTicketDetail(null)
    setSelectedTicket(ticket)
    setLoadingDetail(true)
    try {
      const response = await fetch(`/api/tickets/${ticket.id}`)
      if (!response.ok) {
        throw new Error(`Failed to fetch ticket: ${response.status}`)
      }
      const data = await response.json()
      if (data.ticket) {
        setTicketDetail(data.ticket)
      }
    } catch (error) {
      console.error('Error fetching ticket detail:', error)
      // Clear selection on error
      setSelectedTicket(null)
    } finally {
      setLoadingDetail(false)
    }
  }

  const handleTicketUpdate = (updatedTicket: any) => {
    setTickets((prevTickets) =>
      prevTickets.map((t) =>
        t.id === updatedTicket.id ? { 
          ...t, 
          ...updatedTicket,
          subject: updatedTicket.subject || t.subject || 'No subject'
        } : t
      )
    )
    if (selectedTicket && selectedTicket.id === updatedTicket.id) {
      setTicketDetail({
        ...updatedTicket,
        subject: updatedTicket.subject || selectedTicket.subject || 'No subject'
      })
    }
  }

  // Filter tickets client-side
  const filteredTickets = tickets.filter((ticket) => {
    if (statusFilter.length > 0 && !statusFilter.includes(ticket.status)) return false
    if (priorityFilter.length > 0 && !priorityFilter.includes(ticket.priority)) return false
    if (assignedFilter === 'unassigned' && ticket.assignedAgent) return false
    if (assignedFilter === 'me' && ticket.assignedAgent?.email !== session?.user?.email) return false
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        ticket.subject.toLowerCase().includes(query) ||
        ticket.ticketNumber.toLowerCase().includes(query) ||
        ticket.customer.email.toLowerCase().includes(query) ||
        ticket.customer.name?.toLowerCase().includes(query) ||
        ''
      )
    }
    return true
  })

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Compact Header */}
      <CompactHeader
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        showFilters={showFilters}
        setShowFilters={setShowFilters}
        view={view}
        setView={setView}
        router={router}
        session={session}
      />

      {/* Compact Filters (Collapsible) */}
      {showFilters && (
        <CompactFiltersBar
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          priorityFilter={priorityFilter}
          setPriorityFilter={setPriorityFilter}
          assignedFilter={assignedFilter}
          setAssignedFilter={setAssignedFilter}
          ticketCount={filteredTickets.length}
          tickets={tickets}
        />
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Ticket List or Kanban View */}
        {view === 'list' ? (
          <OptimizedTicketList
            tickets={filteredTickets}
            loading={loading}
            selectedTicket={selectedTicket}
            onSelectTicket={handleTicketSelect}
            onDeleteTicket={session?.user?.role === 'ADMIN' ? handleDeleteClick : undefined}
          />
        ) : (
          <KanbanBoard
            tickets={filteredTickets}
            loading={loading}
            selectedTicket={selectedTicket}
            onSelectTicket={handleTicketSelect}
            onDeleteTicket={session?.user?.role === 'ADMIN' ? handleDeleteClick : undefined}
          />
        )}

        {/* Ticket Detail Panel */}
        {selectedTicket && ticketDetail && ticketDetail.id === selectedTicket.id && (
          <div className="flex-1 bg-white border-l border-gray-200 flex flex-col">
            {loadingDetail ? (
              <div className="flex items-center justify-center h-full">
                <Loader className="w-6 h-6 animate-spin text-gray-400" />
              </div>
            ) : (
              <TicketDetail
                ticket={ticketDetail}
                currentUserId={session?.user?.id || ''}
                viewMode="agent"
                isPanel={true}
                currentUserRole={session?.user?.role as 'ADMIN' | 'AGENT' | 'CUSTOMER'}
                availableAgents={availableAgents}
                onTicketUpdate={handleTicketUpdate}
                onClose={() => {
                  setSelectedTicket(null)
                  setTicketDetail(null)
                }}
              />
            )}
          </div>
        )}
        {selectedTicket && loadingDetail && (
          <div className="flex-1 bg-white border-l border-gray-200 flex items-center justify-center">
            <Loader className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent className="sm:max-w-[425px]">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <AlertDialogTitle className="text-xl">Delete Ticket</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-base pt-2">
              Are you sure you want to delete this ticket? This action cannot be undone and all associated data will be permanently removed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel onClick={() => {
              setDeleteDialogOpen(false)
              setTicketToDelete(null)
            }}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTicket}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete Ticket
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ========================================
// COMPACT HEADER COMPONENT
// ========================================

function CompactHeader({ searchQuery, setSearchQuery, showFilters, setShowFilters, view, setView, router, session }: any) {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        {/* Title */}
        <div className="flex-shrink-0">
          <h1 className="text-2xl font-bold text-gray-900">Inbox</h1>
          <p className="text-sm text-gray-500">Manage support tickets</p>
        </div>

        {/* Search Bar */}
        <div className="flex-1 max-w-2xl">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tickets, customers..."
              className="w-full pl-10 pr-16 py-2.5 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
            />
            <kbd className="absolute right-3 top-1/2 -translate-y-1/2 px-2 py-1 bg-gray-200 text-gray-600 text-xs rounded font-mono">
              ⌘K
            </kbd>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={cn(
              'px-3 py-2 rounded-lg font-medium text-sm transition-colors flex items-center gap-2',
              showFilters
                ? 'bg-blue-100 text-blue-700'
                : 'text-gray-600 hover:bg-gray-100'
            )}
          >
            <Filter className="w-4 h-4" />
            Filters
          </button>

          {/* View Toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setView('list')}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                view === 'list'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              List
            </button>
            <button
              onClick={() => setView('kanban')}
              className={cn(
                'px-3 py-1.5 rounded-md text-sm font-medium transition-all',
                view === 'kanban'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              Kanban
            </button>
          </div>

          {/* New Ticket */}
          <button
            onClick={() => router.push(session?.user?.role === 'AGENT' || session?.user?.role === 'ADMIN' ? '/agent/tickets/new' : '/customer/tickets/new')}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New Ticket
          </button>
        </div>
      </div>
    </div>
  )
}

// ========================================
// COMPACT FILTERS BAR (Single Row)
// ========================================

function CompactFiltersBar({
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  assignedFilter,
  setAssignedFilter,
  ticketCount,
  tickets,
}: any) {
  const statuses = [
    { value: 'NEW', label: 'New', color: 'blue', icon: Circle },
    { value: 'OPEN', label: 'Open', color: 'green', icon: CheckCircle },
    { value: 'IN_PROGRESS', label: 'In Progress', color: 'indigo', icon: Clock },
    { value: 'PENDING', label: 'Pending', color: 'yellow', icon: Clock },
    { value: 'RESOLVED', label: 'Resolved', color: 'purple', icon: CheckCircle },
    { value: 'INITIATE_REFUND', label: 'Initiate Refund', color: 'orange', icon: AlertCircle },
    { value: 'CLOSED', label: 'Closed', color: 'gray', icon: XCircle },
  ]

  // Calculate status counts from tickets
  const statusCounts = useMemo(() => {
    if (!tickets || tickets.length === 0) {
      return {
        NEW: 0,
        OPEN: 0,
        IN_PROGRESS: 0,
        PENDING: 0,
        RESOLVED: 0,
        INITIATE_REFUND: 0,
        CLOSED: 0,
      }
    }
    return {
      NEW: tickets.filter((t: any) => t.status === 'NEW').length,
      OPEN: tickets.filter((t: any) => t.status === 'OPEN').length,
      IN_PROGRESS: tickets.filter((t: any) => t.status === 'IN_PROGRESS').length,
      PENDING: tickets.filter((t: any) => t.status === 'PENDING').length,
      RESOLVED: tickets.filter((t: any) => t.status === 'RESOLVED').length,
      INITIATE_REFUND: tickets.filter((t: any) => t.status === 'INITIATE_REFUND').length,
      CLOSED: tickets.filter((t: any) => t.status === 'CLOSED').length,
    }
  }, [tickets])

  const priorities = [
    { value: 'LOW', label: 'Low' },
    { value: 'NORMAL', label: 'Normal' },
    { value: 'HIGH', label: 'High' },
    { value: 'URGENT', label: 'Urgent' },
  ]

  const toggleStatus = (status: string) => {
    setStatusFilter((prev: string[]) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    )
  }

  const togglePriority = (priority: string) => {
    setPriorityFilter((prev: string[]) =>
      prev.includes(priority) ? prev.filter((p) => p !== priority) : [...prev, priority]
    )
  }

  const getStatusColor = (color: string) => {
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      blue: { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
      green: { bg: '#D1FAE5', text: '#065F46', border: '#6EE7B7' },
      yellow: { bg: '#FEF3C7', text: '#92400E', border: '#FCD34D' },
      purple: { bg: '#EDE9FE', text: '#5B21B6', border: '#C4B5FD' },
      gray: { bg: '#F3F4F6', text: '#374151', border: '#D1D5DB' },
    }
    return colors[color] || colors.gray
  }

  const getPriorityColor = (priority: string) => {
    const colors: Record<string, { bg: string; text: string; border: string }> = {
      URGENT: { bg: '#FEE2E2', text: '#991B1B', border: '#FCA5A5' },
      HIGH: { bg: '#FED7AA', text: '#9A3412', border: '#FDBA74' },
      NORMAL: { bg: '#DBEAFE', text: '#1E40AF', border: '#93C5FD' },
      LOW: { bg: '#F3F4F6', text: '#374151', border: '#D1D5DB' },
    }
    return colors[priority] || colors.NORMAL
  }

  return (
    <div className="bg-white border-b border-gray-200 px-6 py-3">
      <div className="flex flex-wrap items-center gap-4">
        {/* Status Filters */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Status</span>
          <div className="flex gap-1.5 flex-wrap">
            {statuses.map(({ value, label, color, icon: Icon }) => {
              const isActive = statusFilter.includes(value)
              const colorStyle = getStatusColor(color)
              const count = statusCounts[value as keyof typeof statusCounts] || 0
              return (
                <button
                  key={value}
                  onClick={() => toggleStatus(value)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all border-2 flex-shrink-0 relative',
                    isActive ? '' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  )}
                  style={
                    isActive
                      ? {
                          backgroundColor: colorStyle.bg,
                          color: colorStyle.text,
                          borderColor: colorStyle.border,
                        }
                      : {}
                  }
                >
                  <div className="flex items-center gap-1.5">
                    <Icon className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="whitespace-nowrap">{label}</span>
                    {count > 0 && (
                      <span className={cn(
                        'min-w-[18px] h-4 px-1.5 rounded-full text-[10px] font-bold flex items-center justify-center leading-none bg-transparent',
                        isActive 
                          ? 'text-gray-900' 
                          : 'text-gray-600'
                      )}>
                        {count > 99 ? '99+' : count}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-gray-200 flex-shrink-0" />

        {/* Priority Filters */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Priority</span>
          <div className="flex gap-1.5 flex-wrap">
            {priorities.map((priority) => {
              const isActive = priorityFilter.includes(priority.value)
              const colorStyle = getPriorityColor(priority.value)
              return (
                <button
                  key={priority.value}
                  onClick={() => togglePriority(priority.value)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-all border-2 flex-shrink-0 whitespace-nowrap',
                    isActive ? '' : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  )}
                  style={
                    isActive
                      ? {
                          backgroundColor: colorStyle.bg,
                          color: colorStyle.text,
                          borderColor: colorStyle.border,
                        }
                      : {}
                  }
                >
                  {priority.label}
                </button>
              )
            })}
          </div>
        </div>

        {/* Divider */}
        <div className="h-8 w-px bg-gray-200 flex-shrink-0" />

        {/* Assigned Filter */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">Assigned</span>
          <div className="flex gap-1.5 flex-wrap">
            {['me', 'unassigned', 'all'].map((filter) => {
              const isActive = assignedFilter === filter
              return (
                <button
                  key={filter}
                  onClick={() => setAssignedFilter(filter)}
                  className={cn(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-all capitalize border-2 flex-shrink-0 whitespace-nowrap',
                    isActive
                      ? 'bg-blue-100 text-blue-700 border-blue-300'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  )}
                >
                  {filter}
                </button>
              )
            })}
          </div>
        </div>

        {/* Spacer */}
        <div className="flex-1 min-w-[100px]" />

        {/* Results Count & Reset */}
        <div className="flex items-center gap-4 flex-shrink-0">
          <p className="text-sm text-gray-600 whitespace-nowrap">
            <span className="font-semibold text-gray-900">{ticketCount}</span> tickets
          </p>
          <button
            onClick={() => {
              setStatusFilter(['NEW', 'OPEN'])
              setPriorityFilter([])
              setAssignedFilter('all')
            }}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium whitespace-nowrap"
          >
            Reset All
          </button>
        </div>
      </div>
    </div>
  )
}

// ========================================
// OPTIMIZED TICKET LIST (Fixed Width)
// ========================================

function OptimizedTicketList({ tickets, loading, selectedTicket, onSelectTicket, onDeleteTicket }: any) {
  if (loading) {
    return (
      <div className="w-[420px] flex-shrink-0 bg-gray-50 border-r border-gray-200 flex items-center justify-center">
        <div className="text-center">
          <Loader className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading tickets...</p>
        </div>
      </div>
    )
  }

  if (tickets.length === 0) {
    return (
      <div className="w-[420px] flex-shrink-0 bg-gray-50 border-r border-gray-200 flex items-center justify-center">
        <div className="text-center px-4">
          <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="w-12 h-12 text-gray-400" />
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No tickets found</h3>
          <p className="text-gray-600">Try adjusting your filters</p>
        </div>
      </div>
    )
  }

  return (
    <div className="w-[420px] flex-shrink-0 bg-gray-50 border-r border-gray-200 overflow-y-auto">
      {/* Tickets Count */}
      <div className="px-4 py-3 bg-white border-b border-gray-200 sticky top-0 z-10">
        <p className="text-sm text-gray-600">
          Showing <span className="font-semibold text-gray-900">{tickets.length}</span> tickets
        </p>
      </div>

      {/* Ticket Cards */}
      <div className="p-3 space-y-2">
        {tickets.map((ticket: Ticket) => (
          <CompactTicketCard
            key={ticket.id}
            ticket={ticket}
            isSelected={selectedTicket?.id === ticket.id}
            onSelect={() => onSelectTicket(ticket)}
            onDelete={onDeleteTicket}
          />
        ))}
      </div>
    </div>
  )
}

// ========================================
// COMPACT TICKET CARD
// ========================================

function CompactTicketCard({ ticket, isSelected, onSelect, onDelete }: any) {
  // Ensure subject is available
  const ticketSubject = (ticket as any).subject || ticket.subject || 'No subject'
  
  const statusColors: Record<string, string> = {
    NEW: 'text-blue-700 bg-blue-100',
    OPEN: 'text-green-700 bg-green-100',
    PENDING: 'text-yellow-700 bg-yellow-100',
    RESOLVED: 'text-purple-700 bg-purple-100',
    CLOSED: 'text-gray-700 bg-gray-100',
  }

  const priorityColors: Record<string, string> = {
    LOW: 'text-gray-600',
    NORMAL: 'text-blue-600',
    HIGH: 'text-orange-600',
    URGENT: 'text-red-600',
  }

  const status = ticket.status || 'NEW'
  const priority = ticket.priority || 'NORMAL'

  // Get preview from description
  const preview = ticket.description
    ? ticket.description.substring(0, 80).replace(/\n/g, ' ')
    : ''

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent card selection when clicking delete
    if (onDelete) {
      onDelete(ticket.id)
    }
  }

  return (
    <div
      onClick={onSelect}
      className={cn(
        'bg-white rounded-xl border-2 p-4 cursor-pointer transition-all hover:shadow-md group',
        isSelected
          ? 'border-blue-500 shadow-lg'
          : 'border-gray-200 hover:border-gray-300'
      )}
    >
      {/* Header */}
      <div className="flex items-start gap-3 mb-3">
        {/* Avatar */}
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold flex-shrink-0">
          {(ticket.customer.name || ticket.customer.email).charAt(0).toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="text-xs font-mono font-semibold text-gray-500">
              #{ticket.ticketNumber}
            </span>
            <span className={cn('px-2 py-0.5 rounded-full text-xs font-semibold', statusColors[status])}>
              {status}
            </span>
            {priority === 'URGENT' && (
              <span className={cn('text-xs font-bold', priorityColors[priority])}>
                ⚠ {priority}
              </span>
            )}
            {/* Delete Button (Admin Only) */}
            {onDelete && (
              <button
                onClick={handleDelete}
                className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-50 rounded text-red-600 hover:text-red-700"
                title="Delete ticket"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <h3 className="font-semibold text-gray-900 text-sm mb-1 line-clamp-1">
            {ticketSubject}
          </h3>

          {preview && (
            <p className="text-xs text-gray-600 line-clamp-1 mb-2">{preview}</p>
          )}

          {/* Meta */}
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {ticket.customer.name || maskEmail(ticket.customer.email)}
            </span>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        <div className="flex items-center gap-3">
          {ticket.assignedAgent ? (
            <div className="flex items-center gap-1">
              <div className="w-5 h-5 rounded-full bg-teal-500 text-white text-xs flex items-center justify-center font-semibold">
                {(ticket.assignedAgent.name || ticket.assignedAgent.email).charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-gray-600">
                {ticket.assignedAgent.name || ticket.assignedAgent.email}
              </span>
            </div>
          ) : (
            <span className="text-xs text-gray-500 italic">Unassigned</span>
          )}
          <span className="flex items-center gap-1 text-xs text-gray-500">
            <MessageSquare className="w-3 h-3" />
            {ticket._count?.comments || 0}
          </span>
          {(ticket._count?.attachments || 0) > 0 && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              <Paperclip className="w-3 h-3" />
              {ticket._count.attachments}
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">{formatRelativeTime(ticket.updatedAt)}</span>
      </div>
    </div>
  )
}

// ========================================
// TICKET CARD COMPONENT (Original - kept for reference)
// ========================================

function TicketCard({ ticket, isSelected, onSelect }: any) {
  const statusConfig: Record<string, any> = {
    NEW: { color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Circle, label: 'New' },
    OPEN: { color: 'bg-green-100 text-green-700 border-green-200', icon: CheckCircle, label: 'Open' },
    IN_PROGRESS: { color: 'bg-indigo-100 text-indigo-700 border-indigo-200', icon: Clock, label: 'In Progress' },
    PENDING: { color: 'bg-yellow-100 text-yellow-700 border-yellow-200', icon: Clock, label: 'Pending' },
    RESOLVED: { color: 'bg-purple-100 text-purple-700 border-purple-200', icon: CheckCircle, label: 'Resolved' },
    INITIATE_REFUND: { color: 'bg-orange-100 text-orange-700 border-orange-200', icon: AlertCircle, label: 'Initiate Refund' },
    CLOSED: { color: 'bg-gray-100 text-gray-700 border-gray-200', icon: XCircle, label: 'Closed' },
  }

  const priorityConfig: Record<string, any> = {
    LOW: { color: 'text-gray-600', icon: '●', bgColor: 'bg-gray-100' },
    NORMAL: { color: 'text-blue-600', icon: '●', bgColor: 'bg-blue-50' },
    HIGH: { color: 'text-orange-600', icon: '●', bgColor: 'bg-orange-50' },
    URGENT: { color: 'text-red-600', icon: '⚠', bgColor: 'bg-red-50' },
  }

  const status = statusConfig[ticket.status] || statusConfig.NEW
  const priority = priorityConfig[ticket.priority] || priorityConfig.NORMAL
  const StatusIcon = status.icon

  // Get preview from description
  const preview = ticket.description
    ? ticket.description.substring(0, 100).replace(/\n/g, ' ')
    : ''

  return (
    <div
      onClick={onSelect}
      className={cn(
        'group bg-white rounded-2xl border-2 transition-all duration-200 cursor-pointer overflow-hidden',
        'hover:shadow-lg hover:-translate-y-1',
        isSelected
          ? 'border-blue-500 shadow-xl ring-4 ring-blue-100'
          : 'border-gray-200 hover:border-gray-300'
      )}
    >
      {/* Priority Indicator Bar */}
      <div className={cn('h-1.5', priority.bgColor)} />

      <div className="p-5">
        {/* Header Row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            {/* Avatar */}
            <div className="flex-shrink-0">
              {ticket.customer.avatar ? (
                <img
                  src={ticket.customer.avatar}
                  alt={ticket.customer.name || maskEmail(ticket.customer.email)}
                  className="w-12 h-12 rounded-full ring-2 ring-white shadow-md"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-lg ring-2 ring-white shadow-md">
                  {(ticket.customer.name || maskEmail(ticket.customer.email)).charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            {/* Ticket Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-xs font-mono font-semibold text-gray-500 bg-gray-100 px-2 py-1 rounded">
                  #{ticket.ticketNumber}
                </span>

                {/* Status Badge */}
                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border',
                    status.color
                  )}
                >
                  <StatusIcon className="w-3 h-3" />
                  {status.label}
                </span>

                {/* Priority Indicator */}
                <span className={cn('text-sm font-bold', priority.color)}>{priority.icon}</span>
                <span className="text-xs font-medium text-gray-500">{ticket.priority}</span>
              </div>

              <h3 className="text-lg font-semibold text-gray-900 mb-1 line-clamp-1">
                {ticket.subject ? ticket.subject : (ticket as any).subject || 'No subject'}
              </h3>

              {/* Preview */}
              {preview && (
                <p className="text-sm text-gray-600 line-clamp-2 mb-3">{preview}</p>
              )}

              {/* Customer Info */}
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {ticket.customer.name || maskEmail(ticket.customer.email)}
                </span>
                <span className="flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5" />
                  {maskEmail(ticket.customer.email)}
                </span>
              </div>
            </div>

            {/* Quick Actions (shown on hover) */}
            <div className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                }}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <MoreVertical className="w-5 h-5 text-gray-400" />
              </button>
            </div>
          </div>
        </div>

        {/* Footer Row */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Assigned To */}
            {ticket.assignedAgent ? (
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-blue-500 flex items-center justify-center text-white text-xs font-semibold">
                  {(ticket.assignedAgent.name || ticket.assignedAgent.email).charAt(0).toUpperCase()}
                </div>
                <span className="text-xs text-gray-600">{ticket.assignedAgent.name || ticket.assignedAgent.email}</span>
              </div>
            ) : (
              <span className="text-xs text-gray-500 italic">Unassigned</span>
            )}

            {/* Category Tag */}
            {ticket.category && (
              <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-medium">
                <Tag className="w-3 h-3" />
                {ticket.category.name}
              </span>
            )}

            {/* Reply Count */}
            <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
              <MessageSquare className="w-3.5 h-3.5" />
              {ticket._count?.comments || 0}
            </span>

            {/* Attachment Indicator */}
            {(ticket._count?.attachments || 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-gray-500 text-xs">
                <Paperclip className="w-3.5 h-3.5" />
                {ticket._count.attachments}
              </span>
            )}
          </div>

          {/* Time */}
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <Clock className="w-3.5 h-3.5" />
            {formatRelativeTime(ticket.updatedAt)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ========================================
// KANBAN BOARD COMPONENT
// ========================================

function KanbanBoard({ tickets, loading, selectedTicket, onSelectTicket, onDeleteTicket }: any) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-600">Loading tickets...</p>
        </div>
      </div>
    )
  }

  const statusColumns = [
    { status: 'NEW', label: 'New', color: 'bg-blue-50 border-blue-200' },
    { status: 'OPEN', label: 'Open', color: 'bg-green-50 border-green-200' },
    { status: 'IN_PROGRESS', label: 'In Progress', color: 'bg-indigo-50 border-indigo-200' },
    { status: 'PENDING', label: 'Pending', color: 'bg-yellow-50 border-yellow-200' },
    { status: 'RESOLVED', label: 'Resolved', color: 'bg-purple-50 border-purple-200' },
    { status: 'INITIATE_REFUND', label: 'Initiate Refund', color: 'bg-orange-50 border-orange-200' },
    { status: 'CLOSED', label: 'Closed', color: 'bg-gray-50 border-gray-200' },
  ]

  const getTicketsByStatus = (status: string) => {
    return tickets.filter((ticket: Ticket) => ticket.status === status)
  }

  const priorityColors: Record<string, string> = {
    LOW: 'border-l-gray-400',
    NORMAL: 'border-l-blue-400',
    HIGH: 'border-l-orange-400',
    URGENT: 'border-l-red-400',
  }

  return (
    <div className="flex-1 overflow-x-auto bg-gray-50 p-4">
      <div className="flex gap-4 h-full min-w-max">
        {statusColumns.map((column) => {
          const columnTickets = getTicketsByStatus(column.status)
          return (
            <div
              key={column.status}
              className={cn(
                'flex flex-col w-80 flex-shrink-0 rounded-lg border-2',
                column.color
              )}
            >
              {/* Column Header */}
              <div className="p-4 border-b-2 border-current">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold text-gray-900">{column.label}</h3>
                  <span className="px-2 py-1 bg-white rounded-full text-sm font-medium text-gray-700">
                    {columnTickets.length}
                  </span>
                </div>
              </div>

              {/* Tickets */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {columnTickets.length === 0 ? (
                  <div className="text-center py-8 text-gray-400 text-sm">
                    No tickets
                  </div>
                ) : (
                  columnTickets.map((ticket: Ticket) => {
                    const handleDelete = (e: React.MouseEvent) => {
                      e.stopPropagation()
                      if (onDeleteTicket) {
                        onDeleteTicket(ticket.id)
                      }
                    }
                    
                    return (
                      <div
                        key={ticket.id}
                        onClick={() => onSelectTicket(ticket)}
                        className={cn(
                          'bg-white rounded-lg border-l-4 p-4 cursor-pointer transition-all hover:shadow-md group',
                          priorityColors[ticket.priority] || 'border-l-gray-400',
                          selectedTicket?.id === ticket.id
                            ? 'ring-2 ring-blue-500 shadow-lg'
                            : 'hover:border-gray-300'
                        )}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <span className="text-xs font-mono font-semibold text-gray-500 truncate flex-1 min-w-0">
                            #{ticket.ticketNumber}
                          </span>
                          <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                            {ticket.priority === 'URGENT' && (
                              <span className="text-red-600 font-bold text-xs">⚠</span>
                            )}
                            {onDeleteTicket && (
                              <button
                                onClick={handleDelete}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1 hover:bg-red-50 rounded text-red-600 hover:text-red-700"
                                title="Delete ticket"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                        <h4 className="font-semibold text-sm text-gray-900 mb-2 line-clamp-2 break-words">
                          {ticket.subject ? ticket.subject : (ticket as any).subject || 'No subject'}
                        </h4>
                        <div className="flex items-center gap-2 text-xs text-gray-500 mb-2 min-w-0">
                          {ticket.assignedAgent ? (
                            <>
                              <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                                {(ticket.assignedAgent.name || ticket.assignedAgent.email || 'A').charAt(0).toUpperCase()}
                          </div>
                              <span className="truncate min-w-0">
                                {ticket.assignedAgent.name || ticket.assignedAgent.email || 'Unassigned'}
                          </span>
                            </>
                          ) : (
                            <>
                              <div className="w-5 h-5 rounded-full bg-gray-300 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                                <User className="w-3 h-3" />
                              </div>
                              <span className="truncate text-gray-400">Unassigned</span>
                            </>
                          )}
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span className="flex items-center gap-1">
                            <MessageSquare className="w-3 h-3 flex-shrink-0" />
                            {ticket._count?.comments ?? 0}
                          </span>
                          <span className="flex-shrink-0 ml-2">{formatRelativeTime(ticket.updatedAt)}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

