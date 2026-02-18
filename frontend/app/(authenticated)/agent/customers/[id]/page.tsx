'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useParams } from 'next/navigation'
import { useStore } from '@/lib/store-context'
import { useNotificationSocket } from '@/lib/notifications/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime, formatDate, maskPhoneNumber, maskEmail } from '@/lib/utils'
import { User, Mail, Phone, Building, Ticket, ArrowLeft, Calendar, Facebook, Package, Truck } from 'lucide-react'
import Link from 'next/link'

interface Customer {
  id: string
  name: string | null
  email: string
  phone: string | null
  company: string | null
  createdAt: string
}

interface Ticket {
  id: string
  ticketNumber: string
  subject: string
  status: string
  priority: string
  createdAt: string
  category: { name: string } | null
  assignedAgent: { name: string; email: string } | null
}

export default function CustomerDetailPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const params = useParams()
  const { selectedStoreId, loading: storeLoading } = useStore()
  const socket = useNotificationSocket()
  const customerId = params?.id as string

  const [customer, setCustomer] = useState<Customer | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [openTickets, setOpenTickets] = useState(0)
  const [resolvedTickets, setResolvedTickets] = useState(0)
  const [avgTime, setAvgTime] = useState('N/A')
  const [orderTrackingData, setOrderTrackingData] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    } else if (status === 'authenticated' && session?.user?.role !== 'ADMIN' && session?.user?.role !== 'AGENT') {
      router.push('/')
    }
  }, [status, session, router])

  // Fetch customer data
  useEffect(() => {
    if (status === 'authenticated' && (session?.user?.role === 'ADMIN' || session?.user?.role === 'AGENT') && !storeLoading && customerId) {
      if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
        setLoading(false)
        return
      }
      fetchCustomerData()
    }
  }, [status, session, selectedStoreId, storeLoading, customerId])

  const fetchCustomerData = async () => {
    try {
      setLoading(true)

      // For admins, storeId is required
      if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
        return
      }

      // Fetch customer
      const customerParams = new URLSearchParams({
        role: 'CUSTOMER',
      })
      if (session?.user?.role === 'ADMIN' && selectedStoreId) {
        customerParams.append('storeId', selectedStoreId)
      }

      const usersResponse = await fetch(`/api/users?${customerParams.toString()}`)
      if (!usersResponse.ok) throw new Error('Failed to fetch customer')
      const usersData = await usersResponse.json()
      const foundCustomer = usersData.users?.find((u: any) => u.id === customerId)
      
      if (!foundCustomer) {
        router.push('/agent/customers')
        return
      }

      setCustomer(foundCustomer)

      // Fetch tickets for this customer
      const ticketsParams = new URLSearchParams({
        customerId: customerId,
      })
      if (session?.user?.role === 'ADMIN' && selectedStoreId) {
        ticketsParams.append('storeId', selectedStoreId)
      }

      const ticketsResponse = await fetch(`/api/tickets?${ticketsParams.toString()}`)
      if (!ticketsResponse.ok) throw new Error('Failed to fetch tickets')
      const ticketsData = await ticketsResponse.json()
      const customerTickets = ticketsData.tickets || []

      setTickets(customerTickets.slice(0, 10)) // Show first 10

      // Calculate stats
      const open = customerTickets.filter((t: any) =>
        ['NEW', 'OPEN', 'PENDING'].includes(t.status)
      ).length
      const resolved = customerTickets.filter((t: any) =>
        t.status === 'RESOLVED' && t.resolvedAt
      )

      setOpenTickets(open)
      setResolvedTickets(resolved.length)

      // Calculate average resolution time
      if (resolved.length > 0) {
        const totalHours = resolved.reduce((sum: number, ticket: any) => {
          if (ticket.resolvedAt && ticket.createdAt) {
            const hours = (new Date(ticket.resolvedAt).getTime() - new Date(ticket.createdAt).getTime()) / (1000 * 60 * 60)
            return sum + hours
          }
          return sum
        }, 0)
        const avgHours = totalHours / resolved.length
        setAvgTime(`${avgHours.toFixed(1)}h`)
      } else {
        setAvgTime('N/A')
      }

      // Fetch order tracking data if phone is available
      if (foundCustomer.phone) {
        try {
          // Build lookup URL with storeId if available
          const params = new URLSearchParams({
            phone: foundCustomer.phone.replace(/[\s\-\(\)]/g, ''),
          })
          if (selectedStoreId) {
            params.append('storeId', selectedStoreId)
          }

          const orderResponse = await fetch(`/api/order-tracking/lookup?${params.toString()}`)
          if (orderResponse.ok) {
            const orderData = await orderResponse.json()
            if (orderData.found && orderData.data) {
              setOrderTrackingData(orderData.data.slice(0, 5).map((order: any) => ({
                id: order.trackingId || order.orderId,
                channelOrderNumber: order.channelOrderNumber || order.orderId,
                orderId: order.orderId,
                waybillNumber: order.trackingId,
                channelOrderDate: order.channelOrderDate,
                deliveredDate: order.deliveredDate,
                pickupWarehouse: order.pickupWarehouse,
              })))
            }
          }
        } catch (error) {
          console.error('Error fetching order tracking:', error)
        }
      }
    } catch (error) {
      console.error('Error fetching customer data:', error)
      router.push('/agent/customers')
    } finally {
      setLoading(false)
    }
  }

  // Real-time updates: refresh customer data when ticket events fire
  useEffect(() => {
    if (!socket || !customerId) return

    let debounceTimer: NodeJS.Timeout

    const refreshCustomerData = () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        fetchCustomerData()
      }, 300)
    }

    socket.on('ticket:created', refreshCustomerData)
    socket.on('ticket:updated', refreshCustomerData)
    socket.on('ticket:deleted', refreshCustomerData)

    return () => {
      clearTimeout(debounceTimer)
      socket.off('ticket:created', refreshCustomerData)
      socket.off('ticket:updated', refreshCustomerData)
      socket.off('ticket:deleted', refreshCustomerData)
    }
  }, [socket, customerId])

  if (status === 'loading' || storeLoading || loading) {
    return (
      <div>
        <div className="mb-8">
          <div className="text-gray-500">Loading customer data...</div>
        </div>
      </div>
    )
  }

  if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-h1">Customer Details</h1>
          <p className="text-gray-600">Please select a store to view customer details</p>
        </div>
      </div>
    )
  }

  if (!customer) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="text-h1">Customer Not Found</h1>
          <Link href="/agent/customers">
            <Button variant="ghost" size="sm" className="mt-4">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Customers
            </Button>
          </Link>
        </div>
      </div>
    )
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
                  <div className="font-medium">{formatDate(new Date(customer.createdAt))}</div>
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
                    {tickets.length}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">Open</div>
                  <div className="text-3xl font-bold text-primary">{openTickets}</div>
                </div>
                <div>
                  <div className="text-sm text-gray-600 mb-1">Resolved</div>
                  <div className="text-3xl font-bold text-green-600">{resolvedTickets}</div>
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
                {orderTrackingData.map((order) => (
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
                          <span>{formatDate(new Date(order.channelOrderDate))}</span>
                        </div>
                      )}
                      {order.deliveredDate && (
                        <div className="flex items-center justify-between">
                          <span>Delivered Date:</span>
                          <span className="font-medium text-green-600">
                            {formatDate(new Date(order.deliveredDate))}
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
              <Link href={`/agent/tickets?customer=${customer.id}${selectedStoreId ? `&storeId=${selectedStoreId}` : ''}`}>
                <Button variant="outline" size="sm">
                  View All
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {tickets.length === 0 ? (
                <div className="py-12 text-center">
                  <Ticket className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">No tickets yet</h3>
                  <p className="text-sm text-gray-600">This customer hasn&apos;t created any tickets</p>
                </div>
              ) : (
                <div className="divide-y divide-gray-200">
                  {tickets.map((ticket) => (
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
                            <span>{formatRelativeTime(new Date(ticket.createdAt))}</span>
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
