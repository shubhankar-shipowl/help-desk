'use client'

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface TicketVolumeChartProps {
  data: Array<{
    date: string
    created: number
    resolved: number
  }>
}

export function TicketVolumeChart({ data }: TicketVolumeChartProps) {
  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
        <XAxis 
          dataKey="date" 
          stroke="#6B7280"
          style={{ fontSize: '12px' }}
        />
        <YAxis 
          stroke="#6B7280"
          style={{ fontSize: '12px' }}
        />
        <Tooltip 
          contentStyle={{ 
            backgroundColor: '#FFFFFF',
            border: '1px solid #E5E7EB',
            borderRadius: '8px',
            fontSize: '12px'
          }}
        />
        <Legend 
          wrapperStyle={{ fontSize: '12px' }}
        />
        <Line 
          type="monotone" 
          dataKey="created" 
          stroke="#3B82F6" 
          strokeWidth={2}
          name="Created"
          dot={{ fill: '#3B82F6', r: 4 }}
        />
        <Line 
          type="monotone" 
          dataKey="resolved" 
          stroke="#10B981" 
          strokeWidth={2}
          name="Resolved"
          dot={{ fill: '#10B981', r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

