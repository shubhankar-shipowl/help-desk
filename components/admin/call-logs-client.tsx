'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/use-toast'
import {
  Phone,
  Calendar,
  Clock,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Loader2,
  Filter,
  X,
} from 'lucide-react'
import { cn, maskPhoneNumber } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { CustomCalendar } from '@/components/ui/custom-calendar'

interface CallLog {
  id: string
  ticketId: string | null
  ticketNumber: string | null
  ticketSubject: string | null
  agentName: string
  customerName: string
  customerPhone: string
  agentPhone: string
  status: string
  duration: number
  durationFormatted: string
  attempts: number
  remark: string
  startedAt: string
  endedAt: string | null
}

export function CallLogsClient() {
  const { toast } = useToast()
  const [callLogs, setCallLogs] = useState<CallLog[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [dateRangeFilter, setDateRangeFilter] = useState<string>('ALL')
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [datesWithData, setDatesWithData] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  const fetchCallLogs = async (currentPage?: number) => {
    try {
      setLoading(true)
      const pageToUse = currentPage !== undefined ? currentPage : page
      const params = new URLSearchParams({
        page: pageToUse.toString(),
        limit: '50',
      })

      if (statusFilter && statusFilter !== 'ALL') {
        params.append('status', statusFilter)
      }

      // Priority: selectedDate > date range > startDate/endDate
      if (selectedDate) {
        params.append('startDate', selectedDate)
        params.append('endDate', selectedDate)
      } else {
        if (startDate) {
          params.append('startDate', startDate)
        }

        if (endDate) {
          params.append('endDate', endDate)
        }
      }

      const response = await fetch(`/api/call-logs?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch call logs')
      }

      setCallLogs(data.callLogs || [])
      setTotalPages(data.pagination?.totalPages || 1)
      setTotal(data.pagination?.total || 0)
      
      // Set dates with data from API response
      if (data.datesWithData && Array.isArray(data.datesWithData)) {
        setDatesWithData(data.datesWithData)
      } else {
        // Fallback: extract from current call logs
        const dates = new Set<string>()
        if (data.callLogs && Array.isArray(data.callLogs)) {
          data.callLogs.forEach((log: CallLog) => {
            if (log.startedAt) {
              const dateStr = new Date(log.startedAt).toISOString().split('T')[0]
              dates.add(dateStr)
            }
          })
        }
        setDatesWithData(Array.from(dates))
      }
    } catch (error: any) {
      console.error('Error fetching call logs:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch call logs',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchCallLogs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page])

  const handleSearch = () => {
    setPage(1)
    fetchCallLogs(1)
  }

  const handleDateRangeChange = (range: string) => {
    setDateRangeFilter(range)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    
    let newStartDate = ''
    let newEndDate = ''
    
    switch (range) {
      case 'TODAY':
        newStartDate = today.toISOString().split('T')[0]
        newEndDate = today.toISOString().split('T')[0]
        break
      case 'YESTERDAY':
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        newStartDate = yesterday.toISOString().split('T')[0]
        newEndDate = yesterday.toISOString().split('T')[0]
        break
      case 'ALL':
      default:
        newStartDate = ''
        newEndDate = ''
        setSelectedDate(null)
        break
    }
    
    setStartDate(newStartDate)
    setEndDate(newEndDate)
    if (range !== 'ALL') {
      setSelectedDate(null)
    }
    setPage(1)
    // Use setTimeout to ensure state updates before fetching
    setTimeout(() => {
      fetchCallLogs(1)
    }, 100)
  }

  const handleClearFilters = () => {
    setStatusFilter('')
    setStartDate('')
    setEndDate('')
    setSelectedDate(null)
    setDateRangeFilter('ALL')
    setPage(1)
    fetchCallLogs(1)
  }

  const handleFilterChange = () => {
    setPage(1)
    fetchCallLogs(1)
  }

  // Update dateRangeFilter when dates are manually changed
  useEffect(() => {
    if (selectedDate) {
      setDateRangeFilter('CUSTOM')
      return
    }
    
    if (!startDate && !endDate) {
      setDateRangeFilter('ALL')
    } else {
      // Check if the current dates match any preset range
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayStr = today.toISOString().split('T')[0]
      
      if (startDate === todayStr && endDate === todayStr) {
        setDateRangeFilter('TODAY')
      } else {
        const yesterday = new Date(today)
        yesterday.setDate(yesterday.getDate() - 1)
        const yesterdayStr = yesterday.toISOString().split('T')[0]
        
        if (startDate === yesterdayStr && endDate === yesterdayStr) {
          setDateRangeFilter('YESTERDAY')
        } else {
          setDateRangeFilter('CUSTOM')
        }
      }
    }
  }, [startDate, endDate, selectedDate])

  const hasActiveFilters = statusFilter || startDate || endDate || selectedDate || dateRangeFilter !== 'ALL'

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { label: string; className: string; icon: any }> = {
      INITIATED: {
        label: 'Initiated',
        className: 'bg-yellow-100 text-yellow-800 border-yellow-300',
        icon: Clock,
      },
      RINGING: {
        label: 'Ringing',
        className: 'bg-blue-100 text-blue-800 border-blue-300',
        icon: Phone,
      },
      ANSWERED: {
        label: 'Answered',
        className: 'bg-green-100 text-green-800 border-green-300',
        icon: CheckCircle2,
      },
      COMPLETED: {
        label: 'Completed',
        className: 'bg-green-100 text-green-800 border-green-300',
        icon: CheckCircle2,
      },
      FAILED: {
        label: 'Failed',
        className: 'bg-red-100 text-red-800 border-red-300',
        icon: XCircle,
      },
      BUSY: {
        label: 'Busy',
        className: 'bg-orange-100 text-orange-800 border-orange-300',
        icon: AlertCircle,
      },
      NO_ANSWER: {
        label: 'No Answer',
        className: 'bg-gray-100 text-gray-800 border-gray-300',
        icon: XCircle,
      },
      CANCELLED: {
        label: 'Cancelled',
        className: 'bg-gray-100 text-gray-800 border-gray-300',
        icon: XCircle,
      },
    }

    const config = statusConfig[status] || {
      label: status,
      className: 'bg-gray-100 text-gray-800 border-gray-300',
      icon: AlertCircle,
    }

    const Icon = config.icon

    return (
      <span
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
          config.className
        )}
      >
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    )
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    })
  }

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <Calendar className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-h3">Call History</CardTitle>
              <p className="text-sm text-gray-500 mt-1">
                {total} total call{total !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchCallLogs()}
            disabled={loading}
          >
            <RefreshCw className={cn('w-4 h-4 mr-2', loading && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters Header */}
        <div className="mb-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-500" />
              <h3 className="text-sm font-semibold text-gray-700">Filters</h3>
            </div>
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock className="w-4 h-4" />
              <span>{total.toLocaleString()} call{total !== 1 ? 's' : ''} found</span>
            </div>
          </div>

          {/* Filter Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {/* Status Filter */}
            <div>
              <Label htmlFor="status-filter" className="text-xs font-medium text-gray-700 mb-1.5 block">
                Status
              </Label>
              <Select 
                value={statusFilter || 'ALL'} 
                onValueChange={(value) => {
                  setStatusFilter(value === 'ALL' ? '' : value)
                  handleFilterChange()
                }}
              >
                <SelectTrigger id="status-filter" className="w-full">
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All</SelectItem>
                  <SelectItem value="INITIATED">Initiated</SelectItem>
                  <SelectItem value="RINGING">Ringing</SelectItem>
                  <SelectItem value="ANSWERED">Answered</SelectItem>
                  <SelectItem value="COMPLETED">Completed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="BUSY">Busy</SelectItem>
                  <SelectItem value="NO_ANSWER">No Answer</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date Range */}
            <div>
              <Label className="text-xs font-medium text-gray-700 mb-1.5 block">
                Date Range
              </Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={dateRangeFilter === 'ALL' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    handleDateRangeChange('ALL')
                    setSelectedDate(null)
                  }}
                  className={cn(
                    'flex-1 h-9 text-xs',
                    dateRangeFilter === 'ALL' && 'bg-blue-600 text-white hover:bg-blue-700'
                  )}
                >
                  All
                </Button>
                <Button
                  type="button"
                  variant={dateRangeFilter === 'TODAY' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    handleDateRangeChange('TODAY')
                    setSelectedDate(null)
                  }}
                  className={cn(
                    'flex-1 h-9 text-xs',
                    dateRangeFilter === 'TODAY' && 'bg-blue-600 text-white hover:bg-blue-700'
                  )}
                >
                  Today
                </Button>
                <Button
                  type="button"
                  variant={dateRangeFilter === 'YESTERDAY' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => {
                    handleDateRangeChange('YESTERDAY')
                    setSelectedDate(null)
                  }}
                  className={cn(
                    'flex-1 h-9 text-xs',
                    dateRangeFilter === 'YESTERDAY' && 'bg-blue-600 text-white hover:bg-blue-700'
                  )}
                >
                  Yesterday
                </Button>
              </div>
            </div>

            {/* Select Date */}
            <div>
              <Label htmlFor="select-date" className="text-xs font-medium text-gray-700 mb-1.5 block">
                Select Date
              </Label>
              <CustomCalendar
                value={selectedDate || undefined}
                onChange={(date) => {
                  setSelectedDate(date || null)
                  if (date) {
                    setStartDate('')
                    setEndDate('')
                    setDateRangeFilter('CUSTOM')
                    handleFilterChange()
                  } else {
                    setStartDate('')
                    setEndDate('')
                    setDateRangeFilter('ALL')
                    handleFilterChange()
                  }
                }}
                placeholder="Choose a date"
                datesWithData={datesWithData}
              />
            </div>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <div className="flex justify-end">
              <Button
                variant="outline"
                onClick={handleClearFilters}
                disabled={loading}
                size="sm"
                className="h-8 text-xs"
              >
                <X className="w-3 h-3 mr-1.5" />
                Clear Filters
              </Button>
            </div>
          )}
        </div>

        {/* Call Logs Table */}
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        ) : callLogs.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <Phone className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p>No call logs found</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                      NAME
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                      PHONE
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                      TIME
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                      STATUS
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                      CALL DURATION
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                      ATTEMPTS
                    </th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                      REMARK
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {callLogs.map((log) => (
                    <tr
                      key={log.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                            <Phone className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{log.customerName}</p>
                            {log.ticketNumber && (
                              <p className="text-xs text-gray-500">Ticket: {log.ticketNumber}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-sm text-gray-900">{maskPhoneNumber(log.customerPhone)}</p>
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-sm text-gray-600">{formatDate(log.startedAt)}</p>
                      </td>
                      <td className="py-4 px-4">{getStatusBadge(log.status)}</td>
                      <td className="py-4 px-4">
                        <p className="text-sm text-gray-900">{log.durationFormatted}</p>
                      </td>
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center px-2 py-1 rounded-md bg-gray-100 text-xs font-medium text-gray-700">
                          {log.attempts}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <p className="text-sm text-gray-600">{log.remark}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
                <p className="text-sm text-gray-600">
                  Page {page} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1 || loading}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages || loading}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

