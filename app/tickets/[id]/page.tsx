import { prisma } from '@/lib/prisma'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime, formatDate } from '@/lib/utils'
import { Ticket, Calendar, User } from 'lucide-react'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function PublicTicketViewPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { token?: string }
}) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: params.id },
    include: {
      category: true,
      customer: {
        select: {
          name: true,
          email: true,
        },
      },
      assignedAgent: {
        select: {
          name: true,
          email: true,
        },
      },
      comments: {
        where: { isInternal: false }, // Only show public comments
        include: {
          author: {
            select: {
              name: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  })

  if (!ticket) {
    notFound()
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-h1 mb-2">Ticket #{ticket.ticketNumber}</h1>
              <p className="text-gray-600">{ticket.subject}</p>
            </div>
            <Badge
              className={
                ticket.status === 'RESOLVED'
                  ? 'bg-green-600 text-white'
                  : ticket.status === 'OPEN'
                  ? 'text-white'
                  : ticket.status === 'PENDING'
                  ? 'bg-warning text-white'
                  : 'bg-gray-400 text-white'
              }
              style={ticket.status === 'OPEN' ? { backgroundColor: '#2bb9cd' } : undefined}
            >
              {ticket.status}
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Content */}
          <div className="lg:col-span-2 space-y-6">
            {/* Ticket Description */}
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-h3">Ticket Details</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
              </CardContent>
            </Card>

            {/* Comments */}
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-h3">Conversation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {ticket.comments.length === 0 ? (
                  <p className="text-gray-500 text-center py-8">No replies yet</p>
                ) : (
                  ticket.comments.map((comment) => (
                    <div
                      key={comment.id}
                      className={`p-4 rounded-lg ${
                        comment.author.role === 'CUSTOMER'
                          ? 'bg-gray-50 border border-gray-200'
                          : 'border'
                      }`}
                      style={comment.author.role !== 'CUSTOMER' ? { 
                        backgroundColor: 'rgba(43, 185, 205, 0.05)', 
                        borderColor: 'rgba(43, 185, 205, 0.2)' 
                      } : undefined}
                    >
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-semibold text-sm">
                          {comment.author.name || comment.author.email}
                        </span>
                        {comment.author.role !== 'CUSTOMER' && (
                          <Badge variant="outline" className="text-xs">
                            Support Agent
                          </Badge>
                        )}
                        <span className="text-xs text-gray-500 ml-auto">
                          {formatRelativeTime(comment.createdAt)}
                        </span>
                      </div>
                      <p className="text-gray-700 whitespace-pre-wrap">{comment.content}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Ticket Info */}
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-h3">Ticket Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <Ticket className="h-5 w-5 text-gray-400" />
                  <div>
                    <div className="text-sm text-gray-600">Ticket Number</div>
                    <div className="font-mono font-medium">#{ticket.ticketNumber}</div>
                  </div>
                </div>
                {ticket.category && (
                  <div className="flex items-center gap-3">
                    <div>
                      <div className="text-sm text-gray-600">Category</div>
                      <div className="font-medium">{ticket.category.name}</div>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-gray-400" />
                  <div>
                    <div className="text-sm text-gray-600">Created</div>
                    <div className="font-medium">{formatDate(ticket.createdAt)}</div>
                  </div>
                </div>
                {ticket.assignedAgent && (
                  <div className="flex items-center gap-3">
                    <User className="h-5 w-5 text-gray-400" />
                    <div>
                      <div className="text-sm text-gray-600">Assigned To</div>
                      <div className="font-medium">
                        {ticket.assignedAgent.name || ticket.assignedAgent.email}
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Customer Info */}
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-h3">Your Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="text-sm text-gray-600">Name</div>
                  <div className="font-medium">{ticket.customer.name || 'N/A'}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600">Email</div>
                  <div className="font-medium">{ticket.customer.email}</div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}

