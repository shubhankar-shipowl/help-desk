import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { TicketDetail } from '@/components/tickets/ticket-detail'
import { notFound } from 'next/navigation'

export default async function AgentTicketDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const session = await getServerSession(authOptions)

  if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
    redirect('/auth/signin')
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    include: {
      User_Ticket_customerIdToUser: true,
      User_Ticket_assignedAgentIdToUser: {
        select: { id: true, name: true, email: true, avatar: true },
      },
      Team: {
        select: { id: true, name: true, color: true },
      },
      Category: true,
      Comment: {
        include: {
          User: {
            select: { id: true, name: true, email: true, avatar: true, role: true },
          },
          Attachment: true,
        },
        orderBy: { createdAt: 'asc' },
      },
      Attachment: true,
      TicketTag: {
        include: { Tag: true },
      },
      SatisfactionRating: true,
      TicketActivity: {
        include: {
          User: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      },
      FacebookNotification: {
        select: {
          id: true,
          type: true,
          postUrl: true,
          author: true,
          createdAt: true,
        },
      },
    },
  })

  if (!ticket) {
    notFound()
  }

  // Get customer's ticket history
  const customerTickets = await prisma.ticket.findMany({
    where: { customerId: ticket.customerId },
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      status: true,
      createdAt: true,
      resolvedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  // Get available agents and teams for assignment
  const [availableAgents, availableTeams] = await Promise.all([
    session.user.role === 'ADMIN'
      ? prisma.user.findMany({
          where: {
            role: { in: ['AGENT', 'ADMIN'] },
            isActive: true,
          },
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
          orderBy: { name: 'asc' },
        })
      : [],
    prisma.team.findMany({
      where: { isActive: true },
      select: {
        id: true,
        name: true,
        color: true,
      },
      orderBy: { name: 'asc' },
    }),
  ])

  // Get templates for canned responses
  const templates = await prisma.template.findMany({
    where: {
      type: 'CANNED_RESPONSE',
      isActive: true,
    },
    orderBy: [
      { usageCount: 'desc' },
      { name: 'asc' },
    ],
    take: 50,
  })

  // Get current user's phone number
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { phone: true },
  })

  // Convert Decimal to number for serialization (Client Components can't receive Decimal objects)
  const serializedTicket = {
    ...ticket,
    refundAmount: ticket.refundAmount ? parseFloat(ticket.refundAmount.toString()) : null,
  }

  return (
    <TicketDetail
      ticket={serializedTicket}
      currentUserId={session.user.id}
      viewMode="agent"
      customerTickets={customerTickets}
      currentUserRole={session.user.role}
      availableAgents={availableAgents}
      availableTeams={availableTeams}
      templates={templates}
      currentUserPhone={currentUser?.phone}
    />
  )
}

