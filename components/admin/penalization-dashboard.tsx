'use client'

import { useState, useEffect } from 'react'
import { useStore } from '@/lib/store-context'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Download,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Loader2,
  RefreshCw,
  Calendar,
  FileSpreadsheet,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'

interface Ticket {
  id: string
  ticketNumber: string
  customerName: string
  customerEmail: string
  issueType: string
  category: string
  resolvedAt: string | null
  penalizedAt: string | null
  isPenalized: boolean
  refundAmount: number | null
  penalizedBy: string | null
  createdAt: string
  priority?: string
  daysSinceResolution?: number
  vendor?: string | null
}

export function PenalizationDashboard() {
  const { toast } = useToast()
  const { selectedStoreId } = useStore()
  const [activeTab, setActiveTab] = useState('filtered')
  
  // Section 1: Filtered Reports
  const [filteredTickets, setFilteredTickets] = useState<Ticket[]>([])
  const [filteredLoading, setFilteredLoading] = useState(true)
  const [filter, setFilter] = useState('all') // all, penalized, not_penalized
  const [vendorFilter, setVendorFilter] = useState('all') // all or specific vendor
  const [vendors, setVendors] = useState<string[]>([])
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [filteredPage, setFilteredPage] = useState(1)
  const [filteredTotal, setFilteredTotal] = useState(0)
  const [selectedTicket, setSelectedTicket] = useState<string | null>(null)
  const [showPenalizeDialog, setShowPenalizeDialog] = useState(false)
  const [refundAmount, setRefundAmount] = useState('')
  const [penalizing, setPenalizing] = useState(false)

  // Section 2: Download
  const [downloadStartDate, setDownloadStartDate] = useState('')
  const [downloadEndDate, setDownloadEndDate] = useState('')
  const [downloading, setDownloading] = useState(false)

  // Section 3: Pending Penalization
  const [pendingTickets, setPendingTickets] = useState<Ticket[]>([])
  const [pendingLoading, setPendingLoading] = useState(true)
  const [pendingPage, setPendingPage] = useState(1)
  const [pendingTotal, setPendingTotal] = useState(0)
  const [selectedTickets, setSelectedTickets] = useState<Set<string>>(new Set())
  const [bulkPenalizing, setBulkPenalizing] = useState(false)
  const [showBulkDialog, setShowBulkDialog] = useState(false)

  // Fetch vendors list
  const fetchVendors = async () => {
    if (!selectedStoreId) {
      setVendors([])
      return
    }
    
    try {
      const response = await fetch(`/api/order-tracking/vendors?storeId=${selectedStoreId}`)
      const data = await response.json()
      if (response.ok && data.vendors) {
        setVendors(data.vendors.sort())
      }
    } catch (error) {
      console.error('Error fetching vendors:', error)
    }
  }

  // Fetch filtered tickets
  const fetchFilteredTickets = async () => {
    if (!selectedStoreId) {
      toast({
        title: 'Error',
        description: 'Please select a store to view penalization data',
        variant: 'destructive',
      })
      return
    }

    try {
      setFilteredLoading(true)
      const params = new URLSearchParams({
        page: filteredPage.toString(),
        limit: '50',
        filter,
        storeId: selectedStoreId,
      })

      if (vendorFilter && vendorFilter !== 'all') {
        params.append('vendor', vendorFilter)
      }

      if (startDate) {
        params.append('startDate', startDate)
      }

      if (endDate) {
        params.append('endDate', endDate)
      }

      const response = await fetch(`/api/tickets/penalized?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch tickets')
      }

      setFilteredTickets(data.tickets || [])
      setFilteredTotal(data.pagination?.total || 0)
    } catch (error: any) {
      console.error('Error fetching filtered tickets:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch tickets',
        variant: 'destructive',
      })
    } finally {
      setFilteredLoading(false)
    }
  }

  // Fetch pending tickets
  const fetchPendingTickets = async () => {
    if (!selectedStoreId) {
      toast({
        title: 'Error',
        description: 'Please select a store to view pending penalization data',
        variant: 'destructive',
      })
      return
    }

    try {
      setPendingLoading(true)
      const params = new URLSearchParams({
        page: pendingPage.toString(),
        limit: '50',
        days: '30', // Last 30 days
        storeId: selectedStoreId,
      })

      const response = await fetch(`/api/tickets/pending-penalization?${params.toString()}`)
      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch tickets')
      }

      setPendingTickets(data.tickets || [])
      setPendingTotal(data.pagination?.total || 0)
    } catch (error: any) {
      console.error('Error fetching pending tickets:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to fetch tickets',
        variant: 'destructive',
      })
    } finally {
      setPendingLoading(false)
    }
  }

  useEffect(() => {
    if (selectedStoreId) {
      if (activeTab === 'filtered') {
        fetchVendors()
        fetchFilteredTickets()
      } else if (activeTab === 'pending') {
        fetchPendingTickets()
      }
    }
  }, [activeTab, filteredPage, filter, vendorFilter, startDate, endDate, pendingPage, selectedStoreId])

  const handlePenalize = async () => {
    if (!selectedTicket) return

    try {
      setPenalizing(true)
      const response = await fetch('/api/tickets/penalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketIds: [selectedTicket],
          refundAmount: refundAmount ? parseFloat(refundAmount) : null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to penalize ticket')
      }

      toast({
        title: 'Success',
        description: 'Ticket marked as penalized',
        variant: 'default',
      })

      setShowPenalizeDialog(false)
      setSelectedTicket(null)
      setRefundAmount('')
      fetchFilteredTickets()
      if (activeTab === 'pending') {
        fetchPendingTickets()
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to penalize ticket',
        variant: 'destructive',
      })
    } finally {
      setPenalizing(false)
    }
  }

  const handleBulkPenalize = async () => {
    if (selectedTickets.size === 0) return

    try {
      setBulkPenalizing(true)
      const response = await fetch('/api/tickets/penalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketIds: Array.from(selectedTickets),
          refundAmount: null, // Can be enhanced to allow bulk refund amount
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to penalize tickets')
      }

      toast({
        title: 'Success',
        description: `${data.count} ticket(s) marked as penalized`,
        variant: 'default',
      })

      setShowBulkDialog(false)
      setSelectedTickets(new Set())
      fetchPendingTickets()
      fetchFilteredTickets()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to penalize tickets',
        variant: 'destructive',
      })
    } finally {
      setBulkPenalizing(false)
    }
  }

  const handleDownload = async (type: 'penalized' | 'all') => {
    try {
      setDownloading(true)
      const params = new URLSearchParams({
        type,
      })

      if (downloadStartDate) {
        params.append('startDate', downloadStartDate)
      }
      if (downloadEndDate) {
        params.append('endDate', downloadEndDate)
      }

      const response = await fetch(`/api/tickets/penalized/download?${params.toString()}`)
      
      if (!response.ok) {
        throw new Error('Failed to download')
      }

      const blob = await response.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = type === 'penalized' 
        ? `penalized-tickets-${new Date().toISOString().split('T')[0]}.xlsx`
        : `all-resolved-tickets-${new Date().toISOString().split('T')[0]}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      toast({
        title: 'Success',
        description: 'File downloaded successfully',
        variant: 'default',
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to download file',
        variant: 'destructive',
      })
    } finally {
      setDownloading(false)
    }
  }

  const toggleTicketSelection = (ticketId: string) => {
    const newSelection = new Set(selectedTickets)
    if (newSelection.has(ticketId)) {
      newSelection.delete(ticketId)
    } else {
      newSelection.add(ticketId)
    }
    setSelectedTickets(newSelection)
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="filtered">Filtered Reports</TabsTrigger>
          <TabsTrigger value="download">Download</TabsTrigger>
          <TabsTrigger value="pending">Pending Penalization</TabsTrigger>
        </TabsList>

        {/* Section 1: Filtered Reports */}
        <TabsContent value="filtered" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Resolved Tickets with Penalization Status</CardTitle>
                  <CardDescription>
                    View and manage penalization status for resolved tickets
                  </CardDescription>
                </div>
                <div className="flex items-center gap-4">
                  {vendorFilter !== 'all' && (() => {
                    const totalRefund = filteredTickets
                      .filter(t => t.isPenalized && t.refundAmount !== null && t.refundAmount !== undefined)
                      .reduce((sum, t) => sum + (t.refundAmount || 0), 0)
                    const penalizedCount = filteredTickets.filter(t => t.isPenalized).length
                    
                    return (
                      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg px-5 py-3 shadow-sm">
                        <div className="flex flex-col items-end">
                          <span className="text-xs text-blue-600 font-medium mb-1">Total Refund Amount</span>
                          <div className="flex items-baseline gap-2">
                            <span className="text-2xl font-bold text-blue-900">
                              ₹{totalRefund.toFixed(2)}
                            </span>
                            {penalizedCount > 0 && (
                              <span className="text-xs text-blue-600">
                                ({penalizedCount} {penalizedCount === 1 ? 'ticket' : 'tickets'})
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })()}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchFilteredTickets}
                    disabled={filteredLoading}
                  >
                    <RefreshCw className={cn('w-4 h-4 mr-2', filteredLoading && 'animate-spin')} />
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Filters */}
              <div className="mb-6 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="mb-2 block">Filter by Penalization Status</Label>
                    <Select value={filter} onValueChange={(value) => {
                      setFilter(value)
                      setFilteredPage(1)
                    }}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Resolved Tickets</SelectItem>
                        <SelectItem value="penalized">Only Penalized</SelectItem>
                        <SelectItem value="not_penalized">Not Penalized</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="mb-2 block">Filter by Vendor</Label>
                    <Select value={vendorFilter} onValueChange={(value) => {
                      setVendorFilter(value)
                      setFilteredPage(1)
                    }}>
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Vendors</SelectItem>
                        {vendors.map((vendor) => (
                          <SelectItem key={vendor} value={vendor}>
                            {vendor}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="mb-2 block">Start Date</Label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value)
                        setFilteredPage(1)
                      }}
                      className="w-full"
                    />
                  </div>
                  <div>
                    <Label className="mb-2 block">End Date</Label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value)
                        setFilteredPage(1)
                      }}
                      className="w-full"
                    />
                  </div>
                </div>
              </div>

              {/* Table */}
              {filteredLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <AlertTriangle className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>No tickets found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-200">
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                          Ticket ID
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                          Customer Name
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                          Issue Type
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                          Resolution Date
                        </th>
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                          Status
                        </th>
                        {vendorFilter !== 'all' && (
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                            Refund Amount
                          </th>
                        )}
                        <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                          Action
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTickets.map((ticket) => (
                        <tr
                          key={ticket.id}
                          className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                        >
                          <td className="py-4 px-4">
                            <span className="font-medium text-gray-900">{ticket.ticketNumber}</span>
                          </td>
                          <td className="py-4 px-4">
                            <div>
                              <p className="text-sm text-gray-900">{ticket.customerName}</p>
                              <p className="text-xs text-gray-500">{ticket.customerEmail}</p>
                            </div>
                          </td>
                          <td className="py-4 px-4">
                            <p className="text-sm text-gray-900">{ticket.issueType}</p>
                            <p className="text-xs text-gray-500">{ticket.category}</p>
                          </td>
                          <td className="py-4 px-4">
                            <p className="text-sm text-gray-600">{formatDate(ticket.resolvedAt)}</p>
                          </td>
                          <td className="py-4 px-4">
                            {ticket.isPenalized ? (
                              <Badge className="bg-green-100 text-green-800 border-green-300">
                                <CheckCircle2 className="w-3 h-3 mr-1" />
                                Penalized
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="border-gray-300 text-gray-700">
                                Not Penalized
                              </Badge>
                            )}
                          </td>
                          {vendorFilter !== 'all' && (
                            <td className="py-4 px-4">
                              <span className="text-sm font-medium text-gray-900">
                                {ticket.refundAmount !== null && ticket.refundAmount !== undefined
                                  ? `₹${ticket.refundAmount.toFixed(2)}`
                                  : 'N/A'}
                              </span>
                            </td>
                          )}
                          <td className="py-4 px-4">
                            {!ticket.isPenalized ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedTicket(ticket.id)
                                  setShowPenalizeDialog(true)
                                }}
                              >
                                Mark as Penalized
                              </Button>
                            ) : (
                              <span className="text-sm text-gray-500">
                                Penalized by {ticket.penalizedBy || 'Admin'}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {Math.ceil(filteredTotal / 50) > 1 && (
                <div className="flex items-center justify-between mt-6 pt-4 border-t">
                  <p className="text-sm text-gray-600">
                    Page {filteredPage} of {Math.ceil(filteredTotal / 50)} ({filteredTotal} total)
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFilteredPage((p) => Math.max(1, p - 1))}
                      disabled={filteredPage === 1 || filteredLoading}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setFilteredPage((p) => Math.min(Math.ceil(filteredTotal / 50), p + 1))}
                      disabled={filteredPage >= Math.ceil(filteredTotal / 50) || filteredLoading}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Section 2: Download */}
        <TabsContent value="download" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Download Reports</CardTitle>
              <CardDescription>
                Download penalized or all resolved tickets as Excel files
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Date Range Filter */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="download-start-date">Start Date</Label>
                  <Input
                    id="download-start-date"
                    type="date"
                    value={downloadStartDate}
                    onChange={(e) => setDownloadStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="download-end-date">End Date</Label>
                  <Input
                    id="download-end-date"
                    type="date"
                    value={downloadEndDate}
                    onChange={(e) => setDownloadEndDate(e.target.value)}
                    min={downloadStartDate || undefined}
                  />
                </div>
              </div>

              {/* Download Buttons */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="border-2 border-dashed">
                  <CardContent className="pt-6">
                    <div className="text-center space-y-4">
                      <div className="w-12 h-12 mx-auto bg-red-100 rounded-full flex items-center justify-center">
                        <FileSpreadsheet className="w-6 h-6 text-red-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold mb-1">Download Penalized Tickets</h3>
                        <p className="text-sm text-gray-500">
                          Export all penalized tickets to Excel
                        </p>
                      </div>
                      <Button
                        onClick={() => handleDownload('penalized')}
                        disabled={downloading}
                        className="w-full"
                      >
                        {downloading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Downloading...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4 mr-2" />
                            Download Penalized
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-2 border-dashed">
                  <CardContent className="pt-6">
                    <div className="text-center space-y-4">
                      <div className="w-12 h-12 mx-auto bg-blue-100 rounded-full flex items-center justify-center">
                        <FileSpreadsheet className="w-6 h-6 text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-semibold mb-1">Download All Resolved</h3>
                        <p className="text-sm text-gray-500">
                          Export all resolved tickets to Excel
                        </p>
                      </div>
                      <Button
                        onClick={() => handleDownload('all')}
                        disabled={downloading}
                        variant="outline"
                        className="w-full"
                      >
                        {downloading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Downloading...
                          </>
                        ) : (
                          <>
                            <Download className="w-4 h-4 mr-2" />
                            Download All Resolved
                          </>
                        )}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Section 3: Pending Penalization */}
        <TabsContent value="pending" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Fresh Resolved Tickets (Pending Penalization)</CardTitle>
                  <CardDescription>
                    Newly resolved tickets awaiting penalization review
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  {selectedTickets.size > 0 && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => setShowBulkDialog(true)}
                    >
                      Mark {selectedTickets.size} as Penalized
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchPendingTickets}
                    disabled={pendingLoading}
                  >
                    <RefreshCw className={cn('w-4 h-4 mr-2', pendingLoading && 'animate-spin')} />
                    Refresh
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {pendingLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
                </div>
              ) : pendingTickets.length === 0 ? (
                <div className="text-center py-12 text-gray-500">
                  <CheckCircle2 className="w-12 h-12 mx-auto mb-4 text-gray-400" />
                  <p>No pending tickets found</p>
                </div>
              ) : (
                <>
                  <div className="mb-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (selectedTickets.size === pendingTickets.length) {
                          setSelectedTickets(new Set())
                        } else {
                          setSelectedTickets(new Set(pendingTickets.map((t) => t.id)))
                        }
                      }}
                    >
                      {selectedTickets.size === pendingTickets.length ? 'Deselect All' : 'Select All'}
                    </Button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase w-12">
                            <input
                              type="checkbox"
                              checked={selectedTickets.size === pendingTickets.length && pendingTickets.length > 0}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTickets(new Set(pendingTickets.map((t) => t.id)))
                                } else {
                                  setSelectedTickets(new Set())
                                }
                              }}
                              className="rounded border-gray-300"
                            />
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                            Ticket ID
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                            Customer
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                            Issue Type
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                            Priority
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                            Resolved Date
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                            Days Since
                          </th>
                          <th className="text-left py-3 px-4 text-xs font-semibold text-gray-600 uppercase">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pendingTickets.map((ticket) => (
                          <tr
                            key={ticket.id}
                            className={cn(
                              'border-b border-gray-100 hover:bg-gray-50 transition-colors',
                              ticket.priority === 'URGENT' || ticket.priority === 'HIGH' ? 'bg-red-50/50' : ''
                            )}
                          >
                            <td className="py-4 px-4">
                              <input
                                type="checkbox"
                                checked={selectedTickets.has(ticket.id)}
                                onChange={() => toggleTicketSelection(ticket.id)}
                                className="rounded border-gray-300"
                              />
                            </td>
                            <td className="py-4 px-4">
                              <span className="font-medium text-gray-900">{ticket.ticketNumber}</span>
                            </td>
                            <td className="py-4 px-4">
                              <div>
                                <p className="text-sm text-gray-900">{ticket.customerName}</p>
                                <p className="text-xs text-gray-500">{ticket.customerEmail}</p>
                              </div>
                            </td>
                            <td className="py-4 px-4">
                              <p className="text-sm text-gray-900">{ticket.issueType}</p>
                              <p className="text-xs text-gray-500">{ticket.category}</p>
                            </td>
                            <td className="py-4 px-4">
                              {ticket.priority && (
                                <Badge
                                  variant={
                                    ticket.priority === 'URGENT'
                                      ? 'destructive'
                                      : ticket.priority === 'HIGH'
                                      ? 'default'
                                      : 'outline'
                                  }
                                >
                                  {ticket.priority}
                                </Badge>
                              )}
                            </td>
                            <td className="py-4 px-4">
                              <p className="text-sm text-gray-600">{formatDate(ticket.resolvedAt)}</p>
                            </td>
                            <td className="py-4 px-4">
                              <span className="text-sm text-gray-600">
                                {ticket.daysSinceResolution || 0} days
                              </span>
                            </td>
                            <td className="py-4 px-4">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  setSelectedTicket(ticket.id)
                                  setShowPenalizeDialog(true)
                                }}
                              >
                                Mark as Penalized
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {Math.ceil(pendingTotal / 50) > 1 && (
                    <div className="flex items-center justify-between mt-6 pt-4 border-t">
                      <p className="text-sm text-gray-600">
                        Page {pendingPage} of {Math.ceil(pendingTotal / 50)} ({pendingTotal} total)
                      </p>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPendingPage((p) => Math.max(1, p - 1))}
                          disabled={pendingPage === 1 || pendingLoading}
                        >
                          Previous
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPendingPage((p) => Math.min(Math.ceil(pendingTotal / 50), p + 1))}
                          disabled={pendingPage >= Math.ceil(pendingTotal / 50) || pendingLoading}
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
        </TabsContent>
      </Tabs>

      {/* Penalize Dialog */}
      <AlertDialog open={showPenalizeDialog} onOpenChange={setShowPenalizeDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Ticket as Penalized</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the ticket as penalized. Only resolved tickets can be penalized.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="refund-amount">Refund Amount (Optional)</Label>
              <Input
                id="refund-amount"
                type="number"
                step="0.01"
                min="0"
                value={refundAmount}
                onChange={(e) => setRefundAmount(e.target.value)}
                placeholder="Enter refund amount"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handlePenalize} disabled={penalizing}>
              {penalizing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                'Mark as Penalized'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Penalize Dialog */}
      <AlertDialog open={showBulkDialog} onOpenChange={setShowBulkDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Multiple Tickets as Penalized</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark {selectedTickets.size} ticket(s) as penalized. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleBulkPenalize} disabled={bulkPenalizing}>
              {bulkPenalizing ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                `Mark ${selectedTickets.size} as Penalized`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

