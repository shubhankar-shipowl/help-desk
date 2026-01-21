import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { TicketDetail } from '@/components/tickets/ticket-detail'
import { notFound } from 'next/navigation'

export default async function CustomerTicketDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/auth/signin')
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    include: {
      User_Ticket_customerIdToUser: true,
      User_Ticket_assignedAgentIdToUser: {
        select: { id: true, name: true, email: true, avatar: true },
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
    },
  })

  if (!ticket) {
    notFound()
  }

  // Check access: Customers can only view their own tickets
  // Admins and Agents can view any ticket
  if (session.user.role === 'CUSTOMER' && ticket.customerId !== session.user.id) {
    redirect('/customer/tickets')
  }

  return (
    <TicketDetail ticket={ticket} currentUserId={session.user.id} viewMode="customer" />
  )
}

