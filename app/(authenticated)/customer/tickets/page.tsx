'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useNotificationSocket } from '@/lib/notifications/client'
import {
  Search, Plus, Filter, TrendingUp, TrendingDown, Clock,
  CheckCircle, AlertCircle, MessageSquare, Calendar, Tag,
  Ticket, Trash2
} from 'lucide-react'
import { cn, formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'

interface TicketData {
  id: string
  ticketNumber: string
  subject: string
  status: 'NEW' | 'OPEN' | 'PENDING' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'INITIATE_REFUND'
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'
  category: {
    name: string
  } | null
  createdAt: Date
  updatedAt: Date
  resolvedAt: Date | null
  _count: {
    comments: number
    attachments: number
  }
  lastReply?: {
    from: string
    message: string
    time: Date
  }
}

interface Stats {
  open: number
  resolvedThisMonth: number
  avgResponseTime: string
  totalTickets: number
  pendingTickets: number
}

export default function CustomerTicketsPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const socket = useNotificationSocket()
  const [tickets, setTickets] = useState<TicketData[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [stats, setStats] = useState<Stats>({
    open: 0,
    resolvedThisMonth: 0,
    avgResponseTime: 'N/A',
    totalTickets: 0,
    pendingTickets: 0,
  })

  useEffect(() => {
    if (session) {
      fetchTickets()
    }
  }, [session])

  // Listen for ticket deletion via WebSocket
  useEffect(() => {
    if (!socket) return

    const handleTicketDelete = (data: { ticketId: string }) => {
      const { ticketId } = data
      setTickets((prevTickets) => {
        const updatedTickets = prevTickets.filter((t) => t.id !== ticketId)
        return updatedTickets
      })
    }

    socket.on('ticket:deleted', handleTicketDelete)

    return () => {
      socket.off('ticket:deleted', handleTicketDelete)
    }
  }, [socket])

  // Recalculate stats when tickets change
  useEffect(() => {
    if (tickets.length > 0 || !loading) {
      calculateStats(tickets)
    }
  }, [tickets, loading])

  async function handleDeleteTicket(ticketId: string) {
    if (!confirm('Are you sure you want to delete this ticket? This action cannot be undone.')) {
      return
    }

    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete ticket')
      }

      // Remove ticket from list
      setTickets((prevTickets) => prevTickets.filter((t) => t.id !== ticketId))
      // Recalculate stats
      const updatedTickets = tickets.filter((t) => t.id !== ticketId)
      calculateStats(updatedTickets)
    } catch (error: any) {
      console.error('Error deleting ticket:', error)
      alert(error.message || 'Failed to delete ticket')
    }
  }

  async function fetchTickets() {
    try {
      setLoading(true)
      const response = await fetch('/api/tickets')
      if (!response.ok) throw new Error('Failed to fetch tickets')
      
      const data = await response.json()
      const fetchedTickets = data.tickets || []
      
      // Fetch last reply for each ticket
      const ticketsWithReplies = await Promise.all(
        fetchedTickets.map(async (ticket: any) => {
          // Safety check: ensure ticket has an ID
          if (!ticket?.id) {
            console.warn('Ticket missing ID:', ticket)
            return ticket
          }
          
          if (ticket._count?.comments > 0) {
            try {
              const commentsResponse = await fetch(`/api/tickets/${ticket.id}/comments`)
              if (commentsResponse.ok) {
                const commentsData = await commentsResponse.json()
                const comments = commentsData.comments || []
                if (comments.length > 0) {
                  const lastComment = comments[comments.length - 1]
                  return {
                    ...ticket,
                    lastReply: {
                      from: lastComment.author?.name || lastComment.author?.email || 'Support Team',
                      message: lastComment.content || '',
                      time: new Date(lastComment.createdAt),
                    },
                  }
                }
              }
            } catch (error) {
              console.error('Error fetching comments:', error)
            }
          }
          return ticket
        })
      )

      setTickets(ticketsWithReplies)
      calculateStats(ticketsWithReplies)
    } catch (error) {
      console.error('Error fetching tickets:', error)
    } finally {
      setLoading(false)
    }
  }

  function calculateStats(ticketsData: TicketData[]) {
    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    
    const openTickets = ticketsData.filter(
      (t) => t.status === 'OPEN' || t.status === 'NEW' || t.status === 'PENDING'
    ).length
    
    const pendingTickets = ticketsData.filter((t) => t.status === 'PENDING').length
    
    const resolvedThisMonth = ticketsData.filter((t) => {
      if (t.status !== 'RESOLVED' || !t.resolvedAt) return false
      const resolvedDate = new Date(t.resolvedAt)
      return resolvedDate >= startOfMonth
    }).length

    const resolvedTickets = ticketsData.filter(
      (t) => t.status === 'RESOLVED' && t.resolvedAt
    )
    
    let avgResponseTime = 'N/A'
    if (resolvedTickets.length > 0) {
      const totalHours = resolvedTickets.reduce((sum, ticket) => {
        if (ticket.resolvedAt && ticket.createdAt) {
          const hours = (new Date(ticket.resolvedAt).getTime() - new Date(ticket.createdAt).getTime()) / (1000 * 60 * 60)
          return sum + hours
        }
        return sum
      }, 0)
      const avgHours = totalHours / resolvedTickets.length
      avgResponseTime = `${avgHours.toFixed(1)} hrs`
    }

    setStats({
      open: openTickets,
      resolvedThisMonth,
      avgResponseTime,
      totalTickets: ticketsData.length,
      pendingTickets,
    })
  }

  const filteredTickets = tickets.filter((ticket) => {
    // Status filter
    if (statusFilter !== 'all') {
      const statusMap: Record<string, string[]> = {
        open: ['OPEN', 'NEW'],
        pending: ['PENDING'],
        resolved: ['RESOLVED'],
        closed: ['CLOSED'],
      }
      if (!statusMap[statusFilter]?.includes(ticket.status)) {
        return false
      }
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      return (
        ticket.ticketNumber.toLowerCase().includes(query) ||
        ticket.subject.toLowerCase().includes(query) ||
        ticket.category?.name.toLowerCase().includes(query) ||
        false
      )
    }

    return true
  })

  // Count tickets by status for filter badges
  const statusCounts = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 'OPEN' || t.status === 'NEW').length,
    pending: tickets.filter((t) => t.status === 'PENDING').length,
    resolved: tickets.filter((t) => t.status === 'RESOLVED').length,
    closed: tickets.filter((t) => t.status === 'CLOSED').length,
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <Header />

        {/* Stats Grid */}
        <StatsGrid stats={stats} />

        {/* Filters & Search */}
        <FiltersSection
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          statusFilter={statusFilter}
          setStatusFilter={setStatusFilter}
          statusCounts={statusCounts}
        />

        {/* Tickets List */}
        <TicketsSection
          tickets={filteredTickets}
          loading={loading}
          statusFilter={statusFilter}
          session={session}
          onDeleteTicket={session?.user?.role === 'ADMIN' ? handleDeleteTicket : undefined}
        />
      </div>
    </div>
  )
}

// ========================================
// HEADER COMPONENT
// ========================================

function Header() {
  return (
    <div className="flex items-center justify-between mb-6">
      <div>
        <h1 className="text-h1 text-gray-900 mb-1">My Tickets</h1>
        <p className="text-body text-gray-600">View and track all your support tickets</p>
      </div>
      <Link href="/customer/tickets/new">
        <button className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-medium hover:shadow-lg transition-all">
          <Plus className="w-4 h-4" />
          New Ticket
        </button>
      </Link>
    </div>
  )
}

// ========================================
// STATS GRID COMPONENT
// ========================================

function StatsGrid({ stats }: { stats: Stats }) {
  const statCards = [
    {
      title: 'Open Tickets',
      value: stats.open,
      change: `${stats.open} active`,
      trend: stats.open > 0 ? 'up' : 'neutral',
      icon: AlertCircle,
      color: 'blue',
      bgGradient: 'from-blue-500 to-blue-600',
    },
    {
      title: 'Resolved This Month',
      value: stats.resolvedThisMonth,
      change: 'This month',
      trend: 'neutral',
      icon: CheckCircle,
      color: 'green',
      bgGradient: 'from-green-500 to-emerald-600',
    },
    {
      title: 'Avg. Response Time',
      value: stats.avgResponseTime,
      change: stats.avgResponseTime !== 'N/A' ? 'Average' : 'No data yet',
      trend: 'down',
      icon: Clock,
      color: 'purple',
      bgGradient: 'from-purple-500 to-purple-600',
    },
    {
      title: 'Total Tickets',
      value: stats.totalTickets,
      change: 'All time',
      trend: 'neutral',
      icon: Ticket,
      color: 'orange',
      bgGradient: 'from-orange-500 to-red-600',
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      {statCards.map((card, index) => (
        <StatCard key={index} {...card} />
      ))}
    </div>
  )
}

function StatCard({ title, value, change, trend, icon: Icon, color, bgGradient }: any) {
  return (
    <div className="bg-white rounded-lg shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden group">
      {/* Gradient Header */}
      <div className={cn('bg-gradient-to-r h-1', bgGradient)} />

      <div className="p-4">
        {/* Icon & Title */}
        <div className="flex items-center justify-between mb-3">
          <div
            className={cn('w-10 h-10 rounded-lg flex items-center justify-center', `bg-${color}-100 transition-transform`)}
            style={{
              backgroundColor:
                color === 'blue'
                  ? '#DBEAFE'
                  : color === 'green'
                  ? '#D1FAE5'
                  : color === 'purple'
                  ? '#EDE9FE'
                  : '#FED7AA',
            }}
          >
            <Icon
              className="w-5 h-5"
              style={{
                color:
                  color === 'blue'
                    ? '#2563EB'
                    : color === 'green'
                    ? '#059669'
                    : color === 'purple'
                    ? '#7C3AED'
                    : '#EA580C',
              }}
            />
          </div>

          {/* Trend Indicator */}
          <div className="flex items-center gap-1">
            {trend === 'up' && (
              <div className="flex items-center gap-1 text-green-600 text-xs font-semibold">
                <TrendingUp className="w-3.5 h-3.5" />
              </div>
            )}
            {trend === 'down' && (
              <div className="flex items-center gap-1 text-red-600 text-xs font-semibold">
                <TrendingDown className="w-3.5 h-3.5" />
              </div>
            )}
          </div>
        </div>

        {/* Value */}
        <div className="mb-1">
          <div className="text-2xl font-bold text-gray-900 mb-0.5">{value}</div>
          <div className="text-body-sm font-medium text-gray-600">{title}</div>
        </div>

        {/* Change Indicator */}
        <div className="flex items-center gap-2 text-body-sm text-gray-500">
          <span>{change}</span>
        </div>
      </div>
    </div>
  )
}

// ========================================
// FILTERS SECTION
// ========================================

function FiltersSection({
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  statusCounts,
}: any) {
  const statusOptions = [
    { value: 'all', label: 'All Tickets', icon: Ticket, count: statusCounts.all },
    { value: 'open', label: 'Open', icon: AlertCircle, count: statusCounts.open },
    { value: 'pending', label: 'Pending', icon: Clock, count: statusCounts.pending },
    { value: 'resolved', label: 'Resolved', icon: CheckCircle, count: statusCounts.resolved },
    { value: 'closed', label: 'Closed', icon: CheckCircle, count: statusCounts.closed },
  ]

  return (
    <div className="bg-white rounded-lg shadow-md p-4 mb-6">
      <div className="flex flex-col lg:flex-row gap-3">
        {/* Search Bar */}
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search tickets by number, subject, or category..."
              className="w-full pl-10 pr-4 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all text-body"
            />
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 lg:pb-0">
          {statusOptions.map((option) => {
            const Icon = option.icon
            return (
              <button
                key={option.value}
                onClick={() => setStatusFilter(option.value)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg font-medium whitespace-nowrap transition-all text-body-sm',
                  statusFilter === option.value
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {option.label}
                <span
                  className={cn(
                    'px-1.5 py-0.5 rounded-full text-body-sm font-semibold',
                    statusFilter === option.value
                      ? 'bg-white/20 text-white'
                      : 'bg-gray-200 text-gray-700'
                  )}
                >
                  {option.count}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ========================================
// TICKETS SECTION
// ========================================

function TicketsSection({ tickets, loading, statusFilter, onDeleteTicket }: any) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="w-12 h-12 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-body text-gray-600">Loading your tickets...</p>
      </div>
    )
  }

  if (tickets.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-md p-8 text-center">
        <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Ticket className="w-8 h-8 text-gray-400" />
        </div>
        <h3 className="text-h3 text-gray-900 mb-2">No tickets yet</h3>
        <p className="text-body text-gray-600 mb-4">
          You haven&apos;t created any support tickets. Need help? Create your first ticket!
        </p>
        <Link href="/customer/tickets/new">
          <button className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
            Create Your First Ticket
          </button>
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-h3 text-gray-900">Your Recent Tickets</h2>
      </div>

      {/* Ticket Cards */}
      {tickets.map((ticket: TicketData) => (
        <TicketCard 
          key={ticket.id} 
          ticket={ticket} 
          onDelete={onDeleteTicket}
        />
      ))}
    </div>
  )
}

// ========================================
// TICKET CARD COMPONENT
// ========================================

function TicketCard({ ticket, onDelete }: { ticket: TicketData; onDelete?: (ticketId: string) => void }) {
  const statusConfig = {
    NEW: { color: 'bg-blue-100 text-blue-700 border-blue-300', label: 'New', icon: AlertCircle },
    OPEN: { color: 'bg-green-100 text-green-700 border-green-300', label: 'Open', icon: CheckCircle },
    IN_PROGRESS: { color: 'bg-indigo-100 text-indigo-700 border-indigo-300', label: 'In Progress', icon: Clock },
    PENDING: { color: 'bg-yellow-100 text-yellow-700 border-yellow-300', label: 'Pending', icon: Clock },
    RESOLVED: { color: 'bg-purple-100 text-purple-700 border-purple-300', label: 'Resolved', icon: CheckCircle },
    INITIATE_REFUND: { color: 'bg-orange-100 text-orange-700 border-orange-300', label: 'Initiate Refund', icon: AlertCircle },
    CLOSED: { color: 'bg-gray-100 text-gray-700 border-gray-300', label: 'Closed', icon: CheckCircle },
  }

  const priorityConfig = {
    LOW: { color: 'bg-gray-50 text-gray-700 border-gray-300' },
    NORMAL: { color: 'bg-blue-50 text-blue-700 border-blue-300' },
    HIGH: { color: 'bg-orange-50 text-orange-700 border-orange-300' },
    URGENT: { color: 'bg-red-50 text-red-700 border-red-300' },
  }

  const status = statusConfig[ticket.status]
  const priority = priorityConfig[ticket.priority]
  const StatusIcon = status.icon

  const handleDelete = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (onDelete) {
      onDelete(ticket.id)
    }
  }

  return (
    <Link href={`/customer/tickets/${ticket.id}`}>
      <div className="bg-white rounded-lg shadow-md hover:shadow-lg transition-all duration-300 overflow-hidden group cursor-pointer border border-transparent hover:border-blue-500 relative">
        {/* Priority Color Bar */}
        <div
          className={cn(
            'h-1',
            ticket.priority === 'URGENT'
              ? 'bg-gradient-to-r from-red-500 to-red-600'
              : ticket.priority === 'HIGH'
              ? 'bg-gradient-to-r from-orange-500 to-orange-600'
              : ticket.priority === 'NORMAL'
              ? 'bg-gradient-to-r from-blue-500 to-blue-600'
              : 'bg-gradient-to-r from-gray-400 to-gray-500'
          )}
        />

        {/* Delete Button (Admin Only) */}
        {onDelete && (
          <button
            onClick={handleDelete}
            className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-red-50 rounded-lg text-red-600 hover:text-red-700 z-10"
            title="Delete ticket"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}

        <div className="p-4">
          {/* Header Row */}
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              {/* Ticket Number & Badges */}
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <span className="text-body-sm font-mono font-semibold text-gray-600 bg-gray-100 px-2 py-1 rounded-md">
                  #{ticket.ticketNumber}
                </span>

                <span
                  className={cn(
                    'inline-flex items-center gap-1 px-2 py-1 rounded-full text-body-sm font-semibold border',
                    status.color
                  )}
                >
                  <StatusIcon className="w-3.5 h-3.5" />
                  {status.label}
                </span>

                <span className={cn('px-2 py-1 rounded-full text-body-sm font-semibold border', priority.color)}>
                  {ticket.priority === 'URGENT' && '⚠ '}
                  {ticket.priority}
                </span>
              </div>

              {/* Subject */}
              <h3 className="text-h4 font-semibold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors">
                {ticket.subject}
              </h3>

              {/* Metadata */}
              <div className="flex items-center gap-3 text-body-sm text-gray-600 flex-wrap">
                {ticket.category && (
                  <span className="flex items-center gap-1">
                    <Tag className="w-3.5 h-3.5" />
                    {ticket.category.name}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5" />
                  Created {formatRelativeTime(ticket.createdAt)}
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  Updated {formatRelativeTime(ticket.updatedAt || ticket.createdAt)}
                </span>
                {ticket._count.comments > 0 && (
                  <span className="flex items-center gap-1">
                    <MessageSquare className="w-3.5 h-3.5" />
                    {ticket._count.comments} {ticket._count.comments === 1 ? 'reply' : 'replies'}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Last Reply Preview */}
          {ticket.lastReply && (
            <div className="bg-blue-50 border-l-2 border-blue-500 rounded-r-md p-3 mb-3">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                <span className="text-body-sm font-semibold text-blue-900">
                  Latest Reply from {ticket.lastReply.from}
                </span>
                <span className="text-body-sm text-blue-600">{formatRelativeTime(ticket.lastReply.time)}</span>
              </div>
              <p className="text-body-sm text-gray-700 line-clamp-2">{ticket.lastReply.message}</p>
            </div>
          )}

        </div>
      </div>
    </Link>
  )
}
