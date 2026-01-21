'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store-context'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime, maskPhoneNumber, maskEmail } from '@/lib/utils'
import { User, Mail, Phone, Building, Search, Plus, Ticket, Facebook } from 'lucide-react'
import Link from 'next/link'

interface CustomerWithStats {
  id: string
  name: string | null
  email: string
  phone: string | null
  company: string | null
  createdAt: Date
  _count: {
    tickets: number
  }
  openTickets: number
  resolvedTickets: number
  avgTime: string
}

export default function AgentCustomersPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { selectedStoreId, loading: storeLoading } = useStore()
  const [customers, setCustomers] = useState<CustomerWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    } else if (status === 'authenticated' && session?.user?.role !== 'ADMIN' && session?.user?.role !== 'AGENT') {
      router.push('/')
    }
  }, [status, session, router])

  // Fetch customers when store is selected
  useEffect(() => {
    if (status === 'authenticated' && (session?.user?.role === 'ADMIN' || session?.user?.role === 'AGENT') && !storeLoading) {
      if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
        setLoading(false)
        return
      }
      fetchCustomers()
    }
  }, [status, session, selectedStoreId, storeLoading])

  const fetchCustomers = async () => {
    try {
      setLoading(true)
      
      // For admins, storeId is required
      if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
        return
      }

      // Build API URL
      const params = new URLSearchParams({
        role: 'CUSTOMER',
      })

      // Add storeId for both admins and agents if store is selected
      if (selectedStoreId) {
        params.append('storeId', selectedStoreId)
      }

      const response = await fetch(`/api/users?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch customers')
      }

      const data = await response.json()
      let fetchedCustomers = data.users || []

      // Apply search filter client-side
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        fetchedCustomers = fetchedCustomers.filter((customer: any) =>
          customer.name?.toLowerCase().includes(query) ||
          customer.email?.toLowerCase().includes(query)
        )
      }

      // Get ticket stats for each customer
      const customersWithStats = await Promise.all(
        fetchedCustomers.map(async (customer: any) => {
          const ticketsParams = new URLSearchParams({
            customerId: customer.id,
          })
          
          // Add storeId filter for both admins and agents if store is selected
          if (selectedStoreId) {
            ticketsParams.append('storeId', selectedStoreId)
          }

          const ticketsResponse = await fetch(`/api/tickets?${ticketsParams.toString()}`)
          const ticketsData = await ticketsResponse.json()
          const customerTickets = ticketsData.tickets || []

          const openTickets = customerTickets.filter((t: any) =>
            ['NEW', 'OPEN', 'IN_PROGRESS'].includes(t.status)
          )
          const resolvedTickets = customerTickets.filter((t: any) =>
            t.status === 'RESOLVED' && t.resolvedAt
          )

          // Calculate average resolution time
          let avgTime: string = 'N/A'
          if (resolvedTickets.length > 0) {
            const totalHours = resolvedTickets.reduce((sum: number, ticket: any) => {
              if (ticket.resolvedAt && ticket.createdAt) {
                const hours = (new Date(ticket.resolvedAt).getTime() - new Date(ticket.createdAt).getTime()) / (1000 * 60 * 60)
                return sum + hours
              }
              return sum
            }, 0)
            const avgHours = totalHours / resolvedTickets.length
            avgTime = `${avgHours.toFixed(1)}h`
          }

          return {
            ...customer,
            openTickets: openTickets.length,
            resolvedTickets: resolvedTickets.length,
            avgTime,
            _count: {
              tickets: customerTickets.length,
            },
          }
        })
      )

      setCustomers(customersWithStats)
    } catch (error) {
      console.error('Error fetching customers:', error)
    } finally {
      setLoading(false)
    }
  }

  // Refetch when search query changes
  useEffect(() => {
    if (selectedStoreId || session?.user?.role === 'AGENT') {
      fetchCustomers()
    }
  }, [searchQuery])

  if (status === 'loading' || storeLoading || loading) {
    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-h1 mb-2">Customers</h1>
            <p className="text-gray-600">Loading...</p>
          </div>
        </div>
      </div>
    )
  }

  if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
    return (
      <div>
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-h1 mb-2">Customers</h1>
            <p className="text-gray-600">Please select a store to view customers</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-h1 mb-2">Customers</h1>
          <p className="text-gray-600">Manage and view customer information</p>
        </div>
        <Button className="bg-primary hover:bg-primary-dark text-white">
          <Plus className="mr-2 h-4 w-4" />
          New Customer
        </Button>
      </div>

      {/* Search Bar */}
      <Card className="border border-gray-200 shadow-sm mb-6">
        <CardContent className="p-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
            <Input
              type="search"
              placeholder="Search customers by name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 bg-gray-50 border-0"
            />
          </div>
        </CardContent>
      </Card>

      {/* Customers Grid */}
      {customers.length === 0 ? (
        <Card className="border border-gray-200 shadow-sm">
          <CardContent className="py-12">
            <div className="text-center">
              <div className="text-4xl mb-4">👥</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No customers found</h3>
              <p className="text-sm text-gray-600 mb-6">
                {searchQuery
                  ? 'Try adjusting your search criteria'
                  : 'No customers have been created yet'}
              </p>
              {!searchQuery && (
                <Button className="bg-primary hover:bg-primary-dark text-white">
                  <Plus className="mr-2 h-4 w-4" />
                  Create First Customer
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {customers.map((customer) => (
            <Card
              key={customer.id}
              className="border border-gray-200 shadow-sm hover:shadow-md transition-shadow"
            >
              <CardHeader className="border-b border-gray-200">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                      <User className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{customer.name || 'No Name'}</CardTitle>
                        {(customer.email.includes('@facebook.local') || customer.email.startsWith('facebook_')) && (
                          <Facebook className="h-4 w-4 text-blue-600" />
                        )}
                      </div>
                      {!customer.email.includes('@facebook.local') && !customer.email.startsWith('facebook_') && (
                        <p className="text-sm text-gray-600 mt-1">{maskEmail(customer.email)}</p>
                      )}
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2 text-sm">
                  {customer.phone && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Phone className="h-4 w-4" />
                      <span>{maskPhoneNumber(customer.phone)}</span>
                    </div>
                  )}
                  {customer.company && (
                    <div className="flex items-center gap-2 text-gray-600">
                      <Building className="h-4 w-4" />
                      <span>{customer.company}</span>
                    </div>
                  )}
                </div>

                <div className="pt-4 border-t border-gray-200">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-gray-600 mb-1">Total Tickets</div>
                      <div className="text-2xl font-bold text-gray-900">
                        {customer._count.tickets}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-600 mb-1">Open</div>
                      <div className="text-2xl font-bold text-primary">{customer.openTickets}</div>
                    </div>
                    <div>
                      <div className="text-gray-600 mb-1">Resolved</div>
                      <div className="text-2xl font-bold text-green-600">
                        {customer.resolvedTickets}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-600 mb-1">Avg Time</div>
                      <div className="text-2xl font-bold text-gray-900">{customer.avgTime}</div>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-gray-200">
                  <Link href={`/agent/customers/${customer.id}`}>
                    <Button variant="outline" className="w-full">
                      View Profile →
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {customers.length > 0 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
          <span className="text-sm text-gray-600">
            Showing 1-{customers.length} of {customers.length} customers
          </span>
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
