'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { useToast } from '@/components/ui/use-toast'

export default function ReportsPage() {
  const { toast } = useToast()
  const [reportData, setReportData] = useState<any[]>([])
  const [summary, setSummary] = useState<any>({})
  const [isLoading, setIsLoading] = useState(false)
  const [startDate, setStartDate] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
  )
  const [endDate, setEndDate] = useState(
    new Date().toISOString().split('T')[0]
  )
  const [groupBy, setGroupBy] = useState('day')

  const fetchReport = async (e?: React.MouseEvent) => {
    // Prevent form submission if button is inside a form
    if (e) {
      e.preventDefault()
      e.stopPropagation()
    }
    
    setIsLoading(true)
    console.log('[Reports] Fetching report with params:', { startDate, endDate, groupBy })
    
    try {
      const url = `/api/reports/tickets?startDate=${startDate}&endDate=${endDate}&groupBy=${groupBy}`
      console.log('[Reports] Fetching from:', url)
      
      const response = await fetch(url)
      
      console.log('[Reports] Response status:', response.status)
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }))
        console.error('[Reports] API Error:', errorData)
        throw new Error(errorData.error || `Failed to fetch report: ${response.status}`)
      }
      
      const data = await response.json()
      console.log('[Reports] Received data:', { 
        reportDataLength: data.reportData?.length || 0, 
        summary: data.summary 
      })
      
      if (data.error) {
        console.error('[Reports] API Error in response:', data.error)
        toast({
          title: 'Error',
          description: data.error,
          variant: 'destructive',
        })
        setReportData([])
        setSummary({})
        return
      }
      
      setReportData(data.reportData || [])
      setSummary(data.summary || {})
      
      toast({
        title: 'Success',
        description: `Report generated: ${data.summary?.totalTickets || 0} tickets found`,
      })
    } catch (error: any) {
      console.error('[Reports] Error fetching report:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to generate report. Please try again.',
        variant: 'destructive',
      })
      setReportData([])
      setSummary({})
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchReport()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chartData = reportData.map((item: any) => ({
    date: item.displayDate || item.date,
    Total: item.total,
    Resolved: item.resolved,
  }))

  return (
    <div className="container mx-auto py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Reports & Analytics</h1>
        <p className="text-muted-foreground mt-1">
          View ticket statistics and performance metrics
        </p>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Report Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="groupBy">Group By</Label>
              <Select value={groupBy} onValueChange={setGroupBy}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="week">Week</SelectItem>
                  <SelectItem value="month">Month</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button 
                type="button"
                onClick={(e) => fetchReport(e)} 
                disabled={isLoading} 
                className="w-full"
              >
                {isLoading ? 'Loading...' : 'Generate Report'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Total Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.totalTickets || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Resolved Tickets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{summary.resolvedTickets || 0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Avg Resolution Time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {summary.averageResolutionTime
                ? `${summary.averageResolutionTime} hours`
                : 'N/A'}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Ticket Volume Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="Total" fill="#3B82F6" />
                <Bar dataKey="Resolved" fill="#10B981" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-96 flex items-center justify-center text-muted-foreground">
              No data available for the selected period
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

