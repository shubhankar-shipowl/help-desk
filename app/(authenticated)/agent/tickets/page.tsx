'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useStore } from '@/lib/store-context'
import { ModernInbox } from '@/components/tickets/modern-inbox'

export default function AgentTicketsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { selectedStoreId, loading: storeLoading } = useStore()
  const [loading, setLoading] = useState(true)
  const [tickets, setTickets] = useState<any[]>([])
  const [stats, setStats] = useState({
    total: 0,
    open: 0,
    overdue: 0,
    facebook: 0,
  })
  const [teams, setTeams] = useState<any[]>([])
  const [categories, setCategories] = useState<any[]>([])

  // Redirect if not authenticated
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    } else if (status === 'authenticated' && session?.user?.role !== 'ADMIN' && session?.user?.role !== 'AGENT') {
      router.push('/')
    }
  }, [status, session, router])

  // Fetch data when store is selected (for admins) or when component mounts (for agents)
  useEffect(() => {
    if (status === 'authenticated' && (session?.user?.role === 'ADMIN' || session?.user?.role === 'AGENT') && !storeLoading) {
      // For admins, require store selection
      if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
        setLoading(false)
        return
      }
      fetchData()
    }
  }, [status, session, selectedStoreId, storeLoading])

  const fetchData = async () => {
    try {
      setLoading(true)

      // Build query params
      const params = new URLSearchParams()
      
      // For admins, storeId is required
      if (session?.user?.role === 'ADMIN' && selectedStoreId) {
        params.append('storeId', selectedStoreId)
      } else if (session?.user?.role === 'AGENT' && selectedStoreId) {
        // For agents, storeId is optional but include if selected
        params.append('storeId', selectedStoreId)
      }

      // Add other filters from URL
      const statusParam = searchParams.get('status')
      const priorityParam = searchParams.get('priority')
      const categoryParam = searchParams.get('category')
      const searchParam = searchParams.get('search')
      const sourceParam = searchParams.get('source')
      const teamParam = searchParams.get('team')
      const assignedToParam = searchParams.get('assignedTo')

      if (statusParam) params.append('status', statusParam)
      if (priorityParam) params.append('priority', priorityParam)
      if (categoryParam) params.append('categoryId', categoryParam)
      if (searchParam) params.append('search', searchParam)
      if (sourceParam) params.append('source', sourceParam)
      if (teamParam) params.append('team', teamParam)
      if (assignedToParam) params.append('assignedTo', assignedToParam)

      // Fetch tickets
      const ticketsResponse = await fetch(`/api/tickets?${params.toString()}`)
      if (!ticketsResponse.ok) throw new Error('Failed to fetch tickets')
      const ticketsData = await ticketsResponse.json()
      
      // Convert Decimal to number for serialization
      const serializedTickets = (ticketsData.tickets || []).map((ticket: any) => ({
        ...ticket,
        refundAmount: ticket.refundAmount ? parseFloat(ticket.refundAmount.toString()) : null,
      }))
      setTickets(serializedTickets)

      // Fetch stats
      const statsParams = new URLSearchParams()
      if (session?.user?.role === 'ADMIN' && selectedStoreId) {
        statsParams.append('storeId', selectedStoreId)
      } else if (session?.user?.role === 'AGENT' && selectedStoreId) {
        statsParams.append('storeId', selectedStoreId)
      }

      const statsResponse = await fetch(`/api/dashboard/stats?${statsParams.toString()}`)
      if (statsResponse.ok) {
        const statsData = await statsResponse.json()
        setStats({
          total: statsData.totalTickets || 0,
          open: statsData.openTickets || 0,
          overdue: 0, // Calculate if needed
          facebook: 0, // Calculate if needed
        })
      }

      // Fetch teams
      const teamsParams = new URLSearchParams()
      if (session?.user?.role === 'ADMIN' && selectedStoreId) {
        teamsParams.append('storeId', selectedStoreId)
      } else if (session?.user?.role === 'AGENT' && selectedStoreId) {
        teamsParams.append('storeId', selectedStoreId)
      }

      const teamsResponse = await fetch(`/api/teams?${teamsParams.toString()}`)
      if (teamsResponse.ok) {
        const teamsData = await teamsResponse.json()
        setTeams(teamsData.teams || [])
      }

      // Fetch categories
      const categoriesParams = new URLSearchParams()
      if (session?.user?.role === 'ADMIN' && selectedStoreId) {
        categoriesParams.append('storeId', selectedStoreId)
      } else if (session?.user?.role === 'AGENT' && selectedStoreId) {
        categoriesParams.append('storeId', selectedStoreId)
      }

      const categoriesResponse = await fetch(`/api/categories?${categoriesParams.toString()}`)
      if (categoriesResponse.ok) {
        const categoriesData = await categoriesResponse.json()
        setCategories(categoriesData.categories || [])
      }
    } catch (error) {
      console.error('Error fetching data:', error)
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading' || storeLoading || loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading tickets...</div>
      </div>
    )
  }

  if (session?.user?.role === 'ADMIN' && !selectedStoreId) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Please select a store to view tickets</div>
      </div>
    )
  }

  return (
    <ModernInbox 
      initialTickets={tickets}
      stats={stats}
      teams={teams}
      categories={categories}
    />
  )
}
