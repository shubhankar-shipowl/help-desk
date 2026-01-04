import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect, notFound } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime, formatDate, maskPhoneNumber, maskEmail } from '@/lib/utils'
import { User, Mail, Phone, Building, Ticket, ArrowLeft, Calendar, Facebook, Package, Truck } from 'lucide-react'
import Link from 'next/link'

export default async function CustomerDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const session = await getServerSession(authOptions)

  if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
    redirect('/auth/signin')
  }

  const customer = await prisma.user.findUnique({
    where: { id: params.id, role: 'CUSTOMER' },
    include: {
      tickets: {
        include: {
          category: true,
          assignedAgent: {
            select: { name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
      _count: {
        select: { tickets: true },
      },
    },
  })

  if (!customer) {
    notFound()
  }

  // Get tenantId from session
  const tenantId = (session.user as any).tenantId

  const [openTickets, resolvedTicketsData, orderTrackingData] = await Promise.all([
    prisma.ticket.count({
      where: {
        customerId: customer.id,
        status: { in: ['NEW', 'OPEN', 'PENDING'] },
      },
    }),
    prisma.ticket.findMany({
      where: {
        customerId: customer.id,
        status: 'RESOLVED',
      },
      select: {
        createdAt: true,
        resolvedAt: true,
      },
    }),
    // Get order tracking data by phone number if available
    customer.phone
      ? prisma.orderTrackingData.findMany({
          where: {
            tenantId,
            consigneeContact: customer.phone.replace(/[\s\-\(\)]/g, ''),
          },
          orderBy: {
            uploadedAt: 'desc',
          },
          take: 5, // Get up to 5 most recent orders
        })
      : Promise.resolve([]),
  ])

  // Calculate average resolution time
  const resolvedTickets = resolvedTicketsData.filter((t) => t.resolvedAt)
  let avgTime: string = 'N/A'
  if (resolvedTickets.length > 0) {
    const totalHours = resolvedTickets.reduce((sum, ticket) => {
      if (ticket.resolvedAt && ticket.createdAt) {
        const hours = (ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) / (1000 * 60 * 60)
        return sum + hours
      }
      return sum
    }, 0)
    const avgHours = totalHours / resolvedTickets.length
    avgTime = `${avgHours.toFixed(1)}h`
  }

  return (
    <div>
      {/* Header */}
      <div className="mb-8">
        <Link href="/agent/customers">
          <Button variant="ghost" size="sm" className="mb-4">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Customers
          </Button>
        </Link>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <User className="h-8 w-8 text-primary" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-h1">{customer.name || 'No Name'}</h1>
                {(customer.email.includes('@facebook.local') || customer.email.startsWith('facebook_')) && (
                  <Facebook className="h-5 w-5 text-blue-600" />
                )}
              </div>
              {!customer.email.includes('@facebook.local') && !customer.email.startsWith('facebook_') && (
                <p className="text-gray-600">{customer.email}</p>
              )}
            </div>
          </div>
          <Button className="bg-primary hover:bg-primary-dark text-white">
            Edit Customer
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column - Customer Info */}
        <div className="lg:col-span-1 space-y-6">
          {/* Customer Details */}
          <Card className="border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-h3">Customer Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!customer.email.includes('@facebook.local') && !customer.email.startsWith('facebook_') && (
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-gray-400" />
                  <div>
                    <div className="text-sm text-gray-600">Email</div>
                    <div className="font-medium">{maskEmail(customer.email)}</div>
                  </div>
                </div>
              )}
              {customer.phone && (
                <div className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-gray-400" />
                  <div>
                    <div className="text-sm text-gray-600">Phone</div>
                    <div className="font-medium">{maskPhoneNumber(customer.phone)}</div>
                  </div>
                </div>
              )}
              {customer.company && (
                <div className="flex items-center gap-3">
                  <Building className="h-5 w-5 text-gray-400" />
                  <div>
                    <div className="text-sm text-gray-600">Company</div>
                    <div className="font-medium">{customer.company}</div>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-gray-400" />
                <div>
                  <div className="text-sm text-gray-600">Member Since</div>
                  <div className="font-medium">{formatDate(customer.createdAt)}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Ticket Statistics */}
          <Card className="border border-gray-200 shadow-sm">
            <CardHeader>
              <CardTitle className="text-h3">Ticket Statistics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-600 mb-1">Total Tickets</div>
                  <div className="text-3xl font-bold text-gray-900">
                    {customer._count.tickets}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">Open</div>
                  <div className="text-3xl font-bold text-primary">{openTickets}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">Resolved</div>
                  <div className="text-3xl font-bold text-green-600">{resolvedTicketsData.length}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">Avg Time</div>
                  <div className="text-3xl font-bold text-gray-900">{avgTime}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Order Tracking Data */}
          {orderTrackingData.length > 0 && (
            <Card className="border border-gray-200 shadow-sm">
              <CardHeader>
                <CardTitle className="text-h3 flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Order Tracking
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {orderTrackingData.map((order, index) => (
                  <div
                    key={order.id}
                    className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-gray-400" />
                        <span className="text-sm font-medium text-gray-900">
                          Order #{order.channelOrderNumber || order.orderId || 'N/A'}
                        </span>
                      </div>
                    </div>
                    <div className="text-xs text-gray-600 space-y-1">
                      <div className="flex items-center justify-between">
                        <span>Tracking ID:</span>
                        <span className="font-mono font-medium">{order.waybillNumber}</span>
                      </div>
                      {order.channelOrderDate && (
                        <div className="flex items-center justify-between">
                          <span>Order Date:</span>
                          <span>{formatDate(order.channelOrderDate)}</span>
                        </div>
                      )}
                      {order.deliveredDate && (
                        <div className="flex items-center justify-between">
                          <span>Delivered Date:</span>
                          <span className="font-medium text-green-600">
                            {formatDate(order.deliveredDate)}
                          </span>
                        </div>
                      )}
                      {order.pickupWarehouse && (
                        <div className="flex items-center justify-between">
                          <span>Pickup Warehouse:</span>
                          <span className="font-medium">{order.pickupWarehouse}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Column - Ticket History */}
        <div className="lg:col-span-2">
          <Card className="border border-gray-200 shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-h3">Ticket History</CardTitle>
              <Link href={`/agent/tickets?customer=${customer.id}`}>
                <Button variant="outline" size="sm">
                  View All
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {customer.tickets.length === 0 ? (
                <div className="py-12 text-center">
                  <Ticket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No tickets yet</h3>
                  <p className="text-sm text-gray-600">This customer hasn&apos;t created any tickets</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {customer.tickets.map((ticket) => (
                    <Link
                      key={ticket.id}
                      href={`/agent/tickets/${ticket.id}`}
                      className="block p-4 hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="font-mono text-sm text-gray-500">
                              #{ticket.ticketNumber}
                            </span>
                            <span className="font-medium text-gray-900">{ticket.subject}</span>
                            <Badge
                              className={
                                ticket.status === 'RESOLVED'
                                  ? 'bg-green-600 text-white'
                                  : ticket.status === 'OPEN'
                                  ? 'bg-primary text-white'
                                  : ticket.status === 'PENDING'
                                  ? 'bg-warning text-white'
                                  : 'bg-gray-400 text-white'
                              }
                            >
                              {ticket.status}
                            </Badge>
                            {ticket.priority === 'URGENT' && (
                              <Badge className="bg-red-600 text-white">Urgent</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4 text-sm text-gray-600">
                            {ticket.category && (
                              <span>{ticket.category.name}</span>
                            )}
                            {ticket.assignedAgent && (
                              <span>Assigned to {ticket.assignedAgent.name || ticket.assignedAgent.email}</span>
                            )}
                            <span>{formatRelativeTime(ticket.createdAt)}</span>
                          </div>
                        </div>
                        <span className="text-gray-400">→</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

