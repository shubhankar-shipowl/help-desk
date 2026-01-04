'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Loader2, Trash2 } from 'lucide-react'
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

export function OrderTrackingUpload() {
  const { toast } = useToast()
  const [isUploading, setIsUploading] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [uploadStats, setUploadStats] = useState<{
    total: number
    inserted: number
    updated: number
    skipped: number
  } | null>(null)

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    const fileName = file.name.toLowerCase()
    const isValidFileType = 
      fileName.endsWith('.xlsx') || 
      fileName.endsWith('.xls') || 
      fileName.endsWith('.csv')

    if (!isValidFileType) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an Excel (.xlsx, .xls) or CSV (.csv) file',
        variant: 'destructive',
      })
      return
    }

    setIsUploading(true)
    setUploadStats(null)

    try {
      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch('/api/order-tracking/upload', {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to upload sheet')
      }

      setUploadStats(data.stats)
      toast({
        title: 'Success',
        description: `Sheet uploaded successfully! ${data.stats.inserted} new records, ${data.stats.updated} updated.`,
      })
    } catch (error: any) {
      console.error('Error uploading sheet:', error)
      toast({
        title: 'Upload failed',
        description: error.message || 'Failed to upload sheet. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsUploading(false)
      // Reset file input
      if (e.target) {
        e.target.value = ''
      }
    }
  }

  const handleDeleteAll = async () => {
    setIsDeleting(true)
    setShowDeleteDialog(false)

    try {
      const response = await fetch('/api/order-tracking/delete?confirm=true', {
        method: 'DELETE',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to delete order tracking data')
      }

      setUploadStats(null)
      toast({
        title: 'Success',
        description: `Successfully deleted ${data.deleted || 0} order tracking record(s).`,
      })
    } catch (error: any) {
      console.error('Error deleting order tracking data:', error)
      toast({
        title: 'Delete failed',
        description: error.message || 'Failed to delete order tracking data. Please try again.',
        variant: 'destructive',
      })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
              <FileSpreadsheet className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-h3">Order Tracking Data</CardTitle>
              <CardDescription>
                Upload Excel/CSV sheet with order tracking information
              </CardDescription>
            </div>
          </div>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setShowDeleteDialog(true)}
            disabled={isDeleting || isUploading}
            className="gap-2"
          >
            <Trash2 className="w-4 h-4" />
            {isDeleting ? 'Deleting...' : 'Delete All Data'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm text-gray-600">
            Upload a sheet containing the following columns:
          </p>
          <ul className="text-sm text-gray-600 list-disc list-inside space-y-1 ml-2">
            <li><strong>Consignee Contact</strong> - Phone number (required)</li>
            <li><strong>Channel Order Number</strong> - Order ID (required)</li>
            <li><strong>WayBill Number</strong> - Tracking ID (required)</li>
            <li><strong>Pickup Warehouse</strong> - Pickup warehouse (required)</li>
            <li><strong>Channel Order Date</strong> - Order date (optional)</li>
            <li><strong>Delivered Date</strong> - Delivery date (optional)</li>
            <li><strong>Vendor</strong> - Vendor name (optional)</li>
          </ul>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6">
          <div className="flex flex-col items-center justify-center space-y-4">
            <Upload className="w-12 h-12 text-gray-400" />
            <div className="text-center">
              <label
                htmlFor="order-tracking-file"
                className="cursor-pointer"
              >
                <span className="text-sm font-medium text-primary hover:text-primary/80">
                  Click to upload
                </span>
                <span className="text-sm text-gray-500 ml-2">
                  or drag and drop
                </span>
                <input
                  id="order-tracking-file"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={handleFileSelect}
                  disabled={isUploading}
                  className="hidden"
                />
              </label>
              <p className="text-xs text-gray-500 mt-2">
                Excel (.xlsx, .xls) or CSV (.csv) files only
              </p>
            </div>
          </div>
        </div>

        {isUploading && (
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Uploading and processing sheet...</span>
          </div>
        )}

        {uploadStats && !isUploading && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle className="w-5 h-5 text-green-600 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-green-900 mb-2">
                  Upload completed successfully!
                </p>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-gray-600">Total Records</p>
                    <p className="font-semibold text-gray-900">{uploadStats.total}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">New Records</p>
                    <p className="font-semibold text-green-600">{uploadStats.inserted}</p>
                  </div>
                  <div>
                    <p className="text-gray-600">Updated</p>
                    <p className="font-semibold text-blue-600">{uploadStats.updated}</p>
                  </div>
                </div>
                {uploadStats.skipped > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-orange-600">
                    <AlertCircle className="w-4 h-4" />
                    <span>{uploadStats.skipped} records skipped due to errors</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete All Order Tracking Data?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This will permanently delete all order tracking records from the database.
              Are you sure you want to continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAll}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete All
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

