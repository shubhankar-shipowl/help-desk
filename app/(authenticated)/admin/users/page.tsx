import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { User, Mail, Phone, Building, Search, Shield, UserCheck, Users } from 'lucide-react'
import Link from 'next/link'
import { AddUserDialog } from '@/components/admin/add-user-dialog'
import { UserActionsMenu } from '@/components/admin/user-actions-menu'
import { maskPhoneNumber, maskEmail } from '@/lib/utils'

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: { search?: string; role?: string }
}) {
  const session = await getServerSession(authOptions)

  if (!session || session.user.role !== 'ADMIN') {
    redirect('/auth/signin')
  }

  const where: any = {}

  // Filter by role
  if (searchParams.role && searchParams.role !== 'all') {
    where.role = searchParams.role.toUpperCase()
  }

  // Search filter
  if (searchParams.search) {
    where.OR = [
      { name: { contains: searchParams.search, mode: 'insensitive' } },
      { email: { contains: searchParams.search, mode: 'insensitive' } },
    ]
  }

  const users = await prisma.user.findMany({
    where,
    include: {
      _count: {
        select: {
          tickets: true,
          assignedTickets: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })

  // Get additional stats for each user
  const usersWithStats = await Promise.all(
    users.map(async (user) => {
      const [openTickets, resolvedTickets] = await Promise.all([
        prisma.ticket.count({
          where: {
            customerId: user.id,
            status: { in: ['NEW', 'OPEN', 'IN_PROGRESS'] },
          },
        }),
        prisma.ticket.count({
          where: {
            customerId: user.id,
            status: 'RESOLVED',
          },
        }),
      ])

      return {
        ...user,
        openTickets,
        resolvedTickets,
      }
    })
  )

  const roleCounts = {
    ADMIN: await prisma.user.count({ where: { role: 'ADMIN' } }),
    AGENT: await prisma.user.count({ where: { role: 'AGENT' } }),
    CUSTOMER: await prisma.user.count({ where: { role: 'CUSTOMER' } }),
  }

  const roleColors: Record<string, string> = {
    ADMIN: 'bg-red-100 text-red-700',
    AGENT: 'bg-blue-100 text-blue-700',
    CUSTOMER: 'bg-gray-100 text-gray-700',
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-h1 mb-2">User Management</h1>
        <p className="text-gray-600">Manage users, agents, and administrators</p>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card className="border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Total Users</p>
                <p className="text-2xl font-bold">{users.length}</p>
              </div>
              <Users className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Agents</p>
                <p className="text-2xl font-bold">{roleCounts.AGENT}</p>
              </div>
              <UserCheck className="h-8 w-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>
        <Card className="border border-gray-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 mb-1">Customers</p>
                <p className="text-2xl font-bold">{roleCounts.CUSTOMER}</p>
              </div>
              <User className="h-8 w-8 text-gray-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters and Search */}
      <Card className="border border-gray-200 mb-6">
        <CardContent className="p-4">
          <form action="/admin/users" method="get" className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <Input
                name="search"
                placeholder="Search users by name or email..."
                className="pl-10"
                defaultValue={searchParams.search}
              />
              {searchParams.role && (
                <input type="hidden" name="role" value={searchParams.role} />
              )}
            </div>
            <div className="flex gap-2">
              <Link href="/admin/users?role=all">
                <Button
                  variant={!searchParams.role || searchParams.role === 'all' ? 'default' : 'outline'}
                  size="sm"
                >
                  All
                </Button>
              </Link>
              <Link href="/admin/users?role=admin">
                <Button
                  variant={searchParams.role === 'admin' ? 'default' : 'outline'}
                  size="sm"
                >
                  <Shield className="h-4 w-4 mr-1" />
                  Admin
                </Button>
              </Link>
              <Link href="/admin/users?role=agent">
                <Button
                  variant={searchParams.role === 'agent' ? 'default' : 'outline'}
                  size="sm"
                >
                  <UserCheck className="h-4 w-4 mr-1" />
                  Agent
                </Button>
              </Link>
              <Link href="/admin/users?role=customer">
                <Button
                  type="button"
                  variant={searchParams.role === 'customer' ? 'default' : 'outline'}
                  size="sm"
                >
                  <User className="h-4 w-4 mr-1" />
                  Customer
                </Button>
              </Link>
            </div>
            <Button type="submit" variant="outline" size="sm">
              <Search className="h-4 w-4 mr-2" />
              Search
            </Button>
            <AddUserDialog />
          </form>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="border border-gray-200">
        <CardHeader>
          <CardTitle>Users</CardTitle>
          <CardDescription>
            {users.length} user{users.length !== 1 ? 's' : ''} found
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usersWithStats.length === 0 ? (
            <div className="text-center py-12">
              <Users className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No users found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">User</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Role</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Contact</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Tickets</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Status</th>
                    <th className="text-left py-3 px-4 text-sm font-semibold text-gray-700">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {usersWithStats.map((user) => (
                    <tr key={user.id} className="border-b border-gray-100 hover:bg-gray-50">
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                            <User className="h-5 w-5 text-primary" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">
                              {user.name || 'No name'}
                            </p>
                            <p className="text-sm text-gray-500">{user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <Badge className={roleColors[user.role] || 'bg-gray-100 text-gray-700'}>
                          {user.role}
                        </Badge>
                      </td>
                      <td className="py-4 px-4">
                        <div className="space-y-1">
                          {user.email && !user.email.includes('@facebook.local') && !user.email.startsWith('facebook_') && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Mail className="h-4 w-4" />
                              {maskEmail(user.email)}
                            </div>
                          )}
                          {user.phone && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Phone className="h-4 w-4" />
                              {maskPhoneNumber(user.phone)}
                            </div>
                          )}
                          {user.company && (
                            <div className="flex items-center gap-2 text-sm text-gray-600">
                              <Building className="h-4 w-4" />
                              {user.company}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="text-sm">
                          {user.role === 'CUSTOMER' ? (
                            <>
                              <p className="text-gray-900 font-medium">
                                {user._count.tickets} total
                              </p>
                              <p className="text-gray-500">
                                {user.openTickets} open, {user.resolvedTickets} resolved
                              </p>
                            </>
                          ) : user.role === 'AGENT' ? (
                            <>
                              <p className="text-gray-900 font-medium">
                                {user._count.assignedTickets} assigned
                              </p>
                              <p className="text-gray-500">
                                {user._count.tickets} created
                              </p>
                            </>
                          ) : (
                            <p className="text-gray-500">-</p>
                          )}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <Badge
                          variant={user.isActive ? 'default' : 'secondary'}
                          className={user.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}
                        >
                          {user.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="py-4 px-4">
                        <UserActionsMenu user={user} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

