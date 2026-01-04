import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime, maskPhoneNumber, maskEmail } from '@/lib/utils'
import { User, Mail, Phone, Building, Search, Plus, Ticket, Facebook } from 'lucide-react'
import Link from 'next/link'

export default async function AgentCustomersPage({
  searchParams,
}: {
  searchParams: { search?: string }
}) {
  const session = await getServerSession(authOptions)

  if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
    redirect('/auth/signin')
  }

  const where: any = {
    role: 'CUSTOMER',
  }

  if (searchParams.search) {
    where.OR = [
      { name: { contains: searchParams.search, mode: 'insensitive' } },
      { email: { contains: searchParams.search, mode: 'insensitive' } },
    ]
  }

  const customers = await prisma.user.findMany({
    where,
    include: {
      _count: {
        select: {
          tickets: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })

  // Get ticket stats for each customer
  const customersWithStats = await Promise.all(
    customers.map(async (customer) => {
      const [openTickets, resolvedTicketsData] = await Promise.all([
        prisma.ticket.count({
          where: {
            customerId: customer.id,
            status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] },
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

      return {
        ...customer,
        openTickets,
        resolvedTickets: resolvedTicketsData.length,
        avgTime,
      }
    })
  )

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
              defaultValue={searchParams.search}
              className="pl-10 bg-gray-50 border-0"
            />
          </div>
        </CardContent>
      </Card>

      {/* Customers Grid */}
      {customersWithStats.length === 0 ? (
        <Card className="border border-gray-200 shadow-sm">
          <CardContent className="py-12">
            <div className="text-center">
              <div className="text-4xl mb-4">👥</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">No customers found</h3>
              <p className="text-sm text-gray-600 mb-6">
                {searchParams.search
                  ? 'Try adjusting your search criteria'
                  : 'No customers have been created yet'}
              </p>
              {!searchParams.search && (
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
          {customersWithStats.map((customer) => (
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
                          <Facebook className="h-4 w-4 text-blue-600" title="Facebook Customer" />
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
      {customersWithStats.length > 0 && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled>
            Previous
          </Button>
          <span className="text-sm text-gray-600">
            Showing 1-{customersWithStats.length} of {customersWithStats.length} customers
          </span>
          <Button variant="outline" size="sm" disabled>
            Next
          </Button>
        </div>
      )}
    </div>
  )
}

