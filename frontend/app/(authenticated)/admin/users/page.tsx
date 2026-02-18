'use client'

import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useStore } from '@/lib/store-context'
import { useNotificationSocket } from '@/lib/notifications/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { User, Mail, Phone, Building, Search, Shield, UserCheck, Users } from 'lucide-react'
import Link from 'next/link'
import { AddUserDialog } from '@/components/admin/add-user-dialog'
import { UserActionsMenu } from '@/components/admin/user-actions-menu'
import { maskPhoneNumber, maskEmail } from '@/lib/utils'

interface UserWithStats {
  id: string
  name: string | null
  email: string
  role: string
  phone: string | null
  company: string | null
  isActive: boolean
  _count: {
    tickets: number
    assignedTickets: number
  }
  openTickets: number
  resolvedTickets: number
}

export default function AdminUsersPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedStoreId, loading: storeLoading } = useStore()
  const socket = useNotificationSocket()
  const [users, setUsers] = useState<UserWithStats[]>([])
  const [roleCounts, setRoleCounts] = useState({
    ADMIN: 0,
    AGENT: 0,
    CUSTOMER: 0,
  })
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '')
  const [roleFilter, setRoleFilter] = useState(searchParams.get('role') || 'all')

  // Redirect if not admin
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    } else if (status === 'authenticated' && session?.user?.role !== 'ADMIN') {
      router.push('/')
    }
  }, [status, session, router])

  // Fetch users when store is selected
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role === 'ADMIN' && !storeLoading && selectedStoreId) {
      fetchUsers()
    }
  }, [status, session, selectedStoreId, storeLoading, roleFilter, searchQuery])

  const fetchUsers = async () => {
    if (!selectedStoreId) return

    try {
      setLoading(true)
      const params = new URLSearchParams({
        storeId: selectedStoreId,
      })
      
      if (roleFilter && roleFilter !== 'all') {
        params.append('role', roleFilter)
      }

      const response = await fetch(`/api/users?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch users')
      }

      const data = await response.json()
      let fetchedUsers = data.users || []

      // Apply search filter client-side
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        fetchedUsers = fetchedUsers.filter((user: any) =>
          user.name?.toLowerCase().includes(query) ||
          user.email?.toLowerCase().includes(query)
        )
      }

      // Calculate stats for each user
      const usersWithStats = await Promise.all(
        fetchedUsers.map(async (user: any) => {
          const ticketsResponse = await fetch(
            `/api/tickets?storeId=${selectedStoreId}&customerId=${user.id}`
          )
          const ticketsData = await ticketsResponse.json()
          const userTickets = ticketsData.tickets || []

          const openTickets = userTickets.filter((t: any) =>
            ['NEW', 'OPEN', 'IN_PROGRESS'].includes(t.status)
          ).length
          const resolvedTickets = userTickets.filter((t: any) =>
            t.status === 'RESOLVED'
          ).length

          return {
            ...user,
            _count: {
              tickets: userTickets.length,
              assignedTickets: user.role === 'AGENT' ? userTickets.length : 0,
            },
            openTickets,
            resolvedTickets,
          }
        })
      )

      // Calculate role counts
      const counts = {
        ADMIN: usersWithStats.filter((u) => u.role === 'ADMIN').length,
        AGENT: usersWithStats.filter((u) => u.role === 'AGENT').length,
        CUSTOMER: usersWithStats.filter((u) => u.role === 'CUSTOMER').length,
      }

      setUsers(usersWithStats)
      setRoleCounts(counts)
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setLoading(false)
    }
  }

  // Real-time updates: refresh user stats when ticket events fire
  useEffect(() => {
    if (!socket || !selectedStoreId) return

    let debounceTimer: NodeJS.Timeout

    const refreshUsers = () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        fetchUsers()
      }, 300)
    }

    socket.on('ticket:created', refreshUsers)
    socket.on('ticket:updated', refreshUsers)
    socket.on('ticket:deleted', refreshUsers)

    return () => {
      clearTimeout(debounceTimer)
      socket.off('ticket:created', refreshUsers)
      socket.off('ticket:updated', refreshUsers)
      socket.off('ticket:deleted', refreshUsers)
    }
  }, [socket, selectedStoreId])

  const roleColors: Record<string, string> = {
    ADMIN: 'bg-red-100 text-red-700',
    AGENT: 'bg-blue-100 text-blue-700',
    CUSTOMER: 'bg-gray-100 text-gray-700',
  }

  if (status === 'loading' || storeLoading || loading) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-h1 mb-2">User Management</h1>
          <p className="text-gray-600">Loading...</p>
        </div>
      </div>
    )
  }

  if (!selectedStoreId) {
    return (
      <div>
        <div className="mb-6">
          <h1 className="text-h1 mb-2">User Management</h1>
          <p className="text-gray-600">Please select a store to view users</p>
        </div>
      </div>
    )
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
          <div className="flex flex-col md:flex-row gap-4">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-gray-400" />
              <Input
                placeholder="Search users by name or email..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant={roleFilter === 'all' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRoleFilter('all')}
              >
                All
              </Button>
              <Button
                variant={roleFilter === 'admin' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRoleFilter('admin')}
              >
                <Shield className="h-4 w-4 mr-1" />
                Admin
              </Button>
              <Button
                variant={roleFilter === 'agent' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRoleFilter('agent')}
              >
                <UserCheck className="h-4 w-4 mr-1" />
                Agent
              </Button>
              <Button
                variant={roleFilter === 'customer' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setRoleFilter('customer')}
              >
                <User className="h-4 w-4 mr-1" />
                Customer
              </Button>
            </div>
            <AddUserDialog onSuccess={fetchUsers} />
          </div>
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
          {users.length === 0 ? (
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
                  {users.map((user) => (
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
                        <UserActionsMenu user={user} onRefresh={fetchUsers} />
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
