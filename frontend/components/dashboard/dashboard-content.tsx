'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useStore } from '@/lib/store-context'
import { useNotificationSocket } from '@/lib/notifications/client'
import { DashboardStats } from '@/components/dashboard/dashboard-stats'
import { TicketVolumeChart } from '@/components/charts/ticket-volume-chart'
import { CategoryPieChart } from '@/components/charts/category-pie-chart'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'

interface DashboardData {
  openTickets: number
  assignedTickets: number
  resolvedToday: number
  totalTickets: number
  urgentTickets: number
  averageResolutionTime?: number
  recentTickets: any[]
  ticketVolumeData: any[]
  categoryChartData: any[]
}

export function DashboardContent() {
  const { selectedStoreId } = useStore()
  const socket = useNotificationSocket()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardData>({
    openTickets: 0,
    assignedTickets: 0,
    resolvedToday: 0,
    totalTickets: 0,
    urgentTickets: 0,
    averageResolutionTime: undefined,
    recentTickets: [],
    ticketVolumeData: [],
    categoryChartData: [],
  })

  const fetchDashboardData = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true)
      const url = selectedStoreId
        ? `/api/dashboard/stats?storeId=${selectedStoreId}`
        : '/api/dashboard/stats'

      const response = await fetch(url)
      if (!response.ok) {
        throw new Error('Failed to fetch dashboard data')
      }

      const dashboardData = await response.json()
      setData(dashboardData)
    } catch (error) {
      console.error('Error fetching dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }, [selectedStoreId])

  useEffect(() => {
    fetchDashboardData()
  }, [fetchDashboardData])

  // Real-time updates: refresh dashboard when ticket events fire
  useEffect(() => {
    if (!socket) return

    let debounceTimer: NodeJS.Timeout

    const refreshDashboard = () => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        fetchDashboardData(false) // silent refresh (no loading spinner)
      }, 300)
    }

    socket.on('ticket:created', refreshDashboard)
    socket.on('ticket:updated', refreshDashboard)
    socket.on('ticket:deleted', refreshDashboard)

    return () => {
      clearTimeout(debounceTimer)
      socket.off('ticket:created', refreshDashboard)
      socket.off('ticket:updated', refreshDashboard)
      socket.off('ticket:deleted', refreshDashboard)
    }
  }, [socket, fetchDashboardData])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-gray-500">Loading dashboard...</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-h1 mb-2">Dashboard</h1>
          <p className="text-gray-600">Overview of your support tickets and activity</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="h-10 px-4 border border-gray-300 rounded-lg bg-white text-sm">
            <option>Last 7 days</option>
            <option>Last 30 days</option>
            <option>Last 90 days</option>
          </select>
        </div>
      </div>

      <DashboardStats
        openTickets={data.openTickets}
        assignedTickets={data.assignedTickets}
        resolvedToday={data.resolvedToday}
        totalTickets={data.totalTickets}
        urgentTickets={data.urgentTickets}
        averageResolutionTime={data.averageResolutionTime}
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        <Card className="lg:col-span-2 border border-gray-200 shadow-sm">
          <CardHeader className="border-b border-gray-200">
            <CardTitle className="text-h3">Ticket Volume</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {data.ticketVolumeData.length > 0 ? (
              <TicketVolumeChart data={data.ticketVolumeData} />
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                No data available
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-gray-200 shadow-sm">
          <CardHeader className="border-b border-gray-200">
            <CardTitle className="text-h3">Tickets by Category</CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            {data.categoryChartData.length > 0 ? (
              <CategoryPieChart data={data.categoryChartData} />
            ) : (
              <div className="h-64 flex items-center justify-center text-gray-400">
                No data available
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border border-gray-200 shadow-sm">
        <CardHeader className="border-b border-gray-200 flex flex-row items-center justify-between">
          <CardTitle className="text-h3">Recent Tickets</CardTitle>
          <Link href="/agent/tickets" className="text-sm text-primary hover:underline">
            View all →
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {data.recentTickets.length === 0 ? (
            <div className="p-8 text-center text-gray-500">
              <p>No tickets yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {data.recentTickets.slice(0, 5).map((ticket) => (
                <Link
                  key={ticket.id}
                  href={`/agent/tickets/${ticket.id}`}
                  className="block p-4 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 flex-1">
                      <span className="font-mono text-sm text-gray-500">#{ticket.ticketNumber}</span>
                      <span className="font-medium text-gray-900">{ticket.subject}</span>
                      <Badge
                        className={
                          ticket.priority === 'URGENT'
                            ? 'bg-red-600 text-white'
                            : ticket.priority === 'HIGH'
                            ? 'bg-orange-500 text-white'
                            : ticket.priority === 'NORMAL'
                            ? 'bg-primary text-white'
                            : 'bg-gray-500 text-white'
                        }
                      >
                        {ticket.priority}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-gray-600">
                      <span>{ticket.customer?.name || ticket.customer?.email || 'Unknown Customer'}</span>
                      <span>{formatRelativeTime(new Date(ticket.createdAt))}</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
