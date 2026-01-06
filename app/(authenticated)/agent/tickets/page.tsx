import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { ModernInbox } from '@/components/tickets/modern-inbox'

export default async function AgentTicketsPage({
  searchParams,
}: {
  searchParams: { 
    status?: string
    priority?: string
    category?: string
    search?: string
    source?: string
    team?: string
    assignedTo?: string
  }
}) {
  const session = await getServerSession(authOptions)

  if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
    redirect('/auth/signin')
  }

  const where: any = {}

  // Build agent filter
  const agentFilter: any = {}
  if (session.user.role === 'AGENT') {
    // Agents see their assigned tickets or unassigned tickets
    if (searchParams.assignedTo === 'me') {
      agentFilter.assignedAgentId = session.user.id
    } else if (searchParams.assignedTo === 'unassigned') {
      agentFilter.assignedAgentId = null
    } else {
      // Show all tickets for agents (they can filter)
      agentFilter.OR = [
        { assignedAgentId: session.user.id },
        { assignedAgentId: null },
      ]
    }
  }

  // Build other filters
  if (searchParams.status && searchParams.status.trim() !== '') {
    where.status = searchParams.status
  }

  if (searchParams.priority && searchParams.priority.trim() !== '') {
    where.priority = searchParams.priority
  }

  if (searchParams.category && searchParams.category.trim() !== '') {
    where.categoryId = searchParams.category
  }

  if (searchParams.source && searchParams.source.trim() !== '') {
    where.source = searchParams.source
  }

  if (searchParams.team && searchParams.team.trim() !== '') {
    where.assignedTeamId = searchParams.team
  }

  // Build search filter
  const searchFilter: any = {}
  if (searchParams.search && searchParams.search.trim() !== '') {
    searchFilter.OR = [
      { subject: { contains: searchParams.search, mode: 'insensitive' } },
      { description: { contains: searchParams.search, mode: 'insensitive' } },
      { ticketNumber: { contains: searchParams.search, mode: 'insensitive' } },
      { customer: { name: { contains: searchParams.search, mode: 'insensitive' } } },
      { customer: { email: { contains: searchParams.search, mode: 'insensitive' } } },
    ]
  }

  // Combine all filters properly
  const filtersToCombine: any[] = []
  
  // Add agent filter if it exists
  if (Object.keys(agentFilter).length > 0) {
    filtersToCombine.push(agentFilter)
  }
  
  // Add search filter if it exists
  if (Object.keys(searchFilter).length > 0) {
    filtersToCombine.push(searchFilter)
  }
  
  // If we have multiple filters to combine, use AND
  if (filtersToCombine.length > 0) {
    // Merge direct where conditions with combined filters
    const directConditions = Object.entries(where)
      .filter(([k]) => k !== 'AND' && k !== 'OR')
      .map(([k, v]) => ({ [k]: v }))
    
    if (filtersToCombine.length === 1 && directConditions.length === 0) {
      // Only one filter, merge directly
      Object.assign(where, filtersToCombine[0])
    } else {
      // Multiple filters, use AND
      where.AND = [...filtersToCombine, ...directConditions]
      // Remove individual properties that are now in AND
      Object.keys(where).forEach(k => {
        if (k !== 'AND') delete where[k]
      })
    }
  }

  // Get tickets with enhanced data
  const tickets = await prisma.ticket.findMany({
    where,
    include: {
      customer: {
        select: { name: true, email: true, avatar: true },
      },
      category: true,
      assignedAgent: {
        select: { name: true, email: true, avatar: true },
      },
      assignedTeam: {
        select: { id: true, name: true, color: true },
      },
      _count: {
        select: { comments: true, attachments: true },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100, // Limit for performance
  })

  // Get stats
  const [
    totalTickets,
    openTickets,
    overdueTickets,
    facebookTickets,
  ] = await Promise.all([
    prisma.ticket.count({ where: session.user.role === 'AGENT' ? { OR: [{ assignedAgentId: session.user.id }, { assignedAgentId: null }] } : {} }),
    prisma.ticket.count({ 
      where: { 
        ...(session.user.role === 'AGENT' ? { OR: [{ assignedAgentId: session.user.id }, { assignedAgentId: null }] } : {}),
        status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] }
      } 
    }),
    prisma.ticket.count({ 
      where: { 
        ...(session.user.role === 'AGENT' ? { OR: [{ assignedAgentId: session.user.id }, { assignedAgentId: null }] } : {}),
        dueDate: { lt: new Date() },
        status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] }
      } 
    }),
    prisma.ticket.count({ 
      where: { 
        ...(session.user.role === 'AGENT' ? { OR: [{ assignedAgentId: session.user.id }, { assignedAgentId: null }] } : {}),
        source: { in: ['FACEBOOK_POST', 'FACEBOOK_COMMENT', 'FACEBOOK_MESSAGE'] }
      } 
    }),
  ])

  // Get teams and categories for filters
  const [teams, categories] = await Promise.all([
    prisma.team.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.category.findMany({ orderBy: { name: 'asc' } }),
  ])

  // Convert Decimal to number for serialization (Client Components can't receive Decimal objects)
  const serializedTickets = tickets.map(ticket => ({
    ...ticket,
    refundAmount: ticket.refundAmount ? parseFloat(ticket.refundAmount.toString()) : null,
  }))

  return (
    <ModernInbox 
      initialTickets={serializedTickets}
      stats={{
        total: totalTickets,
        open: openTickets,
        overdue: overdueTickets,
        facebook: facebookTickets,
      }}
      teams={teams}
      categories={categories}
    />
  )
}

