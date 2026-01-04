'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Ticket, Clock, AlertCircle, TrendingUp } from 'lucide-react'

interface DashboardStatsProps {
  openTickets: number
  assignedTickets: number
  resolvedToday: number
  totalTickets: number
  averageResolutionTime?: number
  urgentTickets?: number
}

export function DashboardStats({
  openTickets,
  assignedTickets,
  resolvedToday,
  totalTickets,
  averageResolutionTime,
  urgentTickets,
}: DashboardStatsProps) {
  const stats = [
    {
      title: 'Open Tickets',
      value: openTickets,
      icon: Ticket,
      color: 'text-blue-600',
      bgColor: 'bg-blue-100',
      showTrend: false,
    },
    {
      title: 'Pending Response',
      value: assignedTickets,
      icon: Clock,
      color: 'text-orange-600',
      bgColor: 'bg-orange-100',
      showTrend: false,
    },
    {
      title: 'Urgent Tickets',
      value: urgentTickets ?? 0,
      icon: AlertCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-100',
      showTrend: false,
    },
    {
      title: 'Avg Time (hours)',
      value: averageResolutionTime ? `${averageResolutionTime.toFixed(1)}` : 'N/A',
      icon: TrendingUp,
      color: 'text-purple-600',
      bgColor: 'bg-purple-100',
      showTrend: false,
    },
  ]

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
      {stats.map((stat) => {
        const Icon = stat.icon
        return (
          <Card key={stat.title} className="border border-gray-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className={`p-2 rounded-lg ${stat.bgColor}`}>
                  <Icon className={`h-5 w-5 ${stat.color}`} />
                </div>
              </div>
              <div className="text-3xl font-bold text-gray-900 mb-1">{stat.value}</div>
              <div className="text-sm text-gray-600">{stat.title}</div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

