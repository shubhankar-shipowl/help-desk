'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Facebook } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

export function ConnectFacebookButton() {
  const [loading, setLoading] = useState(false)
  const [mounted, setMounted] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()

  // Only run on client side
  useEffect(() => {
    setMounted(true)
  }, [])

  // Check for success/error messages from callback (only on client)
  useEffect(() => {
    if (!mounted) return

    const success = searchParams.get('success')
    const error = searchParams.get('error')

    if (success === 'connected') {
      toast({
        title: 'Success',
        description: 'Facebook page connected successfully!',
        variant: 'default',
      })
      // Remove query params from URL
      router.replace('/admin/integrations')
    }

    if (error) {
      const errorMessages: Record<string, string> = {
        no_code: 'Facebook authorization was cancelled.',
        config_missing: 'Facebook App ID or Secret is not configured. Please set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET in .env file.',
        invalid_secret: 'Invalid Facebook App Secret. Please check FACEBOOK_APP_SECRET in .env file matches your Facebook App settings.',
        token_exchange_failed: 'Failed to exchange authorization code for access token. Please check FACEBOOK_APP_SECRET.',
        pages_fetch_failed: 'Failed to fetch your Facebook pages.',
        no_pages: 'No Facebook pages found. Please ensure you have admin access to at least one page.',
      }

      toast({
        title: 'Connection Failed',
        description: errorMessages[error] || `Error: ${error}`,
        variant: 'destructive',
      })
      // Remove query params from URL
      router.replace('/admin/integrations')
    }
  }, [mounted, searchParams, router, toast])

  const handleConnect = async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/facebook/connect')
      const data = await response.json()

      if (!response.ok) {
        const errorMsg = data.error || 'Failed to initiate Facebook connection'
        console.error('[Facebook Connect] API Error:', errorMsg)
        throw new Error(errorMsg)
      }

      // Redirect to Facebook OAuth
      if (data.authUrl) {
        console.log('[Facebook Connect] Redirecting to Facebook OAuth:', data.authUrl.substring(0, 50) + '...')
        window.location.href = data.authUrl
      } else {
        throw new Error('No authorization URL received from server')
      }
    } catch (error: any) {
      console.error('[Facebook Connect] Error:', error)
      toast({
        title: 'Connection Error',
        description: error.message || 'Failed to connect to Facebook. Please check your FACEBOOK_APP_ID in .env file.',
        variant: 'destructive',
      })
      setLoading(false)
    }
  }

  return (
    <Button
      onClick={handleConnect}
      disabled={loading}
      className="bg-blue-600 hover:bg-blue-700 text-white"
    >
      <Facebook className="h-4 w-4 mr-2" />
      {loading ? 'Connecting...' : 'Connect Facebook Page'}
    </Button>
  )
}

