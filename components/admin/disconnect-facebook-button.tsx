'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { XCircle } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
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

// Debug logging
if (typeof window !== 'undefined') {
  console.log('[DisconnectButton] Component loaded')
}

interface DisconnectFacebookButtonProps {
  pageId: string
  pageName: string
}

export function DisconnectFacebookButton({ pageId, pageName }: DisconnectFacebookButtonProps) {
  const [loading, setLoading] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const router = useRouter()
  const { toast } = useToast()

  const handleDisconnect = async () => {
    console.log('[DisconnectButton] handleDisconnect called', { pageId, pageName })
    setLoading(true)
    try {
      console.log('[DisconnectButton] Calling API...')
      const response = await fetch(`/api/facebook/disconnect?pageId=${encodeURIComponent(pageId)}`, {
        method: 'DELETE',
      })

      console.log('[DisconnectButton] API response status:', response.status)
      const data = await response.json()
      console.log('[DisconnectButton] API response data:', data)

      if (!response.ok) {
        throw new Error(data.error || 'Failed to disconnect Facebook page')
      }

      console.log('[DisconnectButton] Success! Showing toast and refreshing...')
      toast({
        title: 'Success',
        description: `Facebook page "${pageName}" disconnected successfully`,
        variant: 'default',
      })

      // Refresh the page to show updated integrations
      setTimeout(() => {
        router.refresh()
      }, 1000)
    } catch (error: any) {
      console.error('[DisconnectButton] Error disconnecting Facebook page:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to disconnect Facebook page',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
      setShowDialog(false)
    }
  }

  const handleButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    console.log('[DisconnectButton] Button clicked!', { pageId, pageName, currentDialogState: showDialog })
    setShowDialog(true)
    console.log('[DisconnectButton] setShowDialog(true) called')
  }

  // Debug render
  if (typeof window !== 'undefined') {
    console.log('[DisconnectButton] Component rendered', { pageId, pageName, showDialog, loading })
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={(e) => {
          console.log('[DisconnectButton] onClick fired directly')
          e.preventDefault()
          e.stopPropagation()
          setShowDialog(true)
        }}
        disabled={loading}
        type="button"
        className="cursor-pointer z-10"
      >
        <XCircle className="h-4 w-4 mr-2" />
        {loading ? 'Disconnecting...' : 'Disconnect'}
      </Button>

      <AlertDialog open={showDialog} onOpenChange={setShowDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect Facebook Page?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to disconnect <strong>{pageName}</strong>? 
              This will stop receiving notifications from this page. You can reconnect it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDisconnect}
              disabled={loading}
              className="bg-red-600 hover:bg-red-700"
            >
              {loading ? 'Disconnecting...' : 'Disconnect'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

