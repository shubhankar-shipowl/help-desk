'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useStore } from '@/lib/store-context'
import { AdminDashboard } from '@/components/admin/admin-dashboard'

export default function AdminPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { selectedStoreId, loading: storeLoading } = useStore()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalTickets: 0,
    openTickets: 0,
    resolvedTickets: 0,
    totalUsers: 0,
    totalAgents: 0,
    totalCustomers: 0,
    csatAverage: 0,
    averageResolutionTime: 0,
  })
  const [recentTickets, setRecentTickets] = useState<any[]>([])
  const [agentPerformance, setAgentPerformance] = useState<any[]>([])

  // Redirect if not admin
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    } else if (status === 'authenticated' && session?.user?.role !== 'ADMIN') {
      router.push('/')
    }
  }, [status, session, router])

  // Fetch dashboard data when store is selected
  useEffect(() => {
    if (status === 'authenticated' && session?.user?.role === 'ADMIN' && !storeLoading) {
      // Only fetch if a store is selected
      if (selectedStoreId) {
        fetchDashboardData()
      } else {
        setLoading(false)
      }
    }
  }, [status, session, selectedStoreId, storeLoading])

  const fetchDashboardData = async () => {
    if (!selectedStoreId) return

    try {
      setLoading(true)
      
      // Fetch stats from API
      const statsResponse = await fetch(`/api/dashboard/stats?storeId=${selectedStoreId}`)
      if (!statsResponse.ok) throw new Error('Failed to fetch stats')
      const statsData = await statsResponse.json()

      // Fetch recent tickets
      const ticketsResponse = await fetch(`/api/tickets?storeId=${selectedStoreId}&limit=10`)
      if (!ticketsResponse.ok) throw new Error('Failed to fetch tickets')
      const ticketsData = await ticketsResponse.json()

      // Fetch users for the store
      const usersResponse = await fetch(`/api/users?storeId=${selectedStoreId}`)
      if (!usersResponse.ok) throw new Error('Failed to fetch users')
      const usersData = await usersResponse.json()

      // Calculate stats
      const agents = usersData.users?.filter((u: any) => u.role === 'AGENT') || []
      const customers = usersData.users?.filter((u: any) => u.role === 'CUSTOMER') || []

      // Fetch agent performance
      const agentPerformanceData = await Promise.all(
        agents.map(async (agent: any) => {
          const agentTicketsResponse = await fetch(
            `/api/tickets?storeId=${selectedStoreId}&assignedAgentId=${agent.id}`
          )
          const agentTicketsData = await agentTicketsResponse.json()
          const agentTickets = agentTicketsData.tickets || []
          
          const resolvedTickets = agentTickets.filter((t: any) => t.status === 'RESOLVED')
          const openTickets = agentTickets.filter((t: any) => 
            ['NEW', 'OPEN', 'IN_PROGRESS'].includes(t.status)
          )

          return {
            ...agent,
            assignedTickets: resolvedTickets,
            _count: {
              assignedTickets: openTickets.length,
            },
          }
        })
      )

      setStats({
        totalTickets: statsData.totalTickets || 0,
        openTickets: statsData.openTickets || 0,
        resolvedTickets: statsData.resolvedTickets || 0,
        totalUsers: usersData.users?.length || 0,
        totalAgents: agents.length,
        totalCustomers: customers.length,
        csatAverage: statsData.csatAverage || 0,
        averageResolutionTime: statsData.averageResolutionTime || 0,
      })

      setRecentTickets(ticketsData.tickets?.slice(0, 10) || [])
      setAgentPerformance(agentPerformanceData)
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading' || storeLoading || loading) {
    return (
      <div className="container mx-auto py-8">
        <div className="flex items-center justify-center py-12">
          <div className="text-gray-500">Loading dashboard...</div>
        </div>
      </div>
    )
  }

  if (!selectedStoreId) {
    return (
      <div className="container mx-auto py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground mt-1">
            Please select a store to view dashboard data
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">
          System overview and management
        </p>
      </div>
      <AdminDashboard
        stats={stats}
        recentTickets={recentTickets}
        agentPerformance={agentPerformance}
      />
    </div>
  )
}

