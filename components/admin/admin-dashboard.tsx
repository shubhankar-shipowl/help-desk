'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatRelativeTime } from '@/lib/utils'
import {
  Ticket,
  Users,
  UserCheck,
  UserCircle,
  CheckCircle,
  Star,
  TrendingUp,
} from 'lucide-react'
import Link from 'next/link'

interface AdminDashboardProps {
  stats: {
    totalTickets: number
    openTickets: number
    resolvedTickets: number
    totalUsers: number
    totalAgents: number
    totalCustomers: number
    csatAverage: number
    averageResolutionTime: number
  }
  recentTickets: any[]
  agentPerformance: any[]
}

export function AdminDashboard({
  stats,
  recentTickets,
  agentPerformance,
}: AdminDashboardProps) {
  const statCards = [
    {
      title: 'Total Tickets',
      value: stats.totalTickets,
      icon: Ticket,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
    },
    {
      title: 'Open Tickets',
      value: stats.openTickets,
      icon: TrendingUp,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100',
    },
    {
      title: 'Resolved Tickets',
      value: stats.resolvedTickets,
      icon: CheckCircle,
      color: 'text-green-600',
      bgColor: 'bg-green-100',
    },
    {
      title: 'Total Users',
      value: stats.totalUsers,
      icon: Users,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
    },
    {
      title: 'Agents',
      value: stats.totalAgents,
      icon: UserCheck,
      color: 'text-indigo-600',
      bgColor: 'bg-indigo-100',
    },
    {
      title: 'Customers',
      value: stats.totalCustomers,
      icon: UserCircle,
      color: 'text-pink-600',
      bgColor: 'bg-pink-100',
    },
    {
      title: 'CSAT Average',
      value: stats.csatAverage > 0 ? `${stats.csatAverage.toFixed(1)}/5` : 'N/A',
      icon: Star,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-100',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{stat.title}</CardTitle>
                <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                  <Icon className={`h-4 w-4 ${stat.color}`} />
                </div>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stat.value}</div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Recent Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentTickets.length === 0 ? (
                <p className="text-sm text-muted-foreground">No tickets yet</p>
              ) : (
                recentTickets.map((ticket) => (
                  <Link
                    key={ticket.id}
                    href={`/agent/tickets/${ticket.id}`}
                    className="block p-3 rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-muted-foreground">
                            {ticket.ticketNumber}
                          </span>
                          <Badge variant="outline">{ticket.status}</Badge>
                        </div>
                        <p className="text-sm font-medium">{ticket.subject}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {ticket.customer.name || ticket.customer.email}
                        </p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(ticket.createdAt)}
                      </span>
                    </div>
                  </Link>
                ))
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Agent Performance (Last 30 Days)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {agentPerformance.length === 0 ? (
                <p className="text-sm text-muted-foreground">No agents yet</p>
              ) : (
                agentPerformance.map((agent) => (
                  <div
                    key={agent.id}
                    className="p-3 rounded-lg border bg-card"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-medium">{agent.name || agent.email}</p>
                        <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                          <span>
                            {agent.assignedTickets.length} resolved
                          </span>
                          <span>
                            {agent._count.assignedTickets} open
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

