'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Facebook, Save, Eye, EyeOff } from 'lucide-react'

export function FacebookConfig() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPasswords, setShowPasswords] = useState({
    appSecret: false,
    webhookToken: false,
    pageAccessToken: false,
  })

  const [config, setConfig] = useState({
    facebookAppId: '',
    facebookAppSecret: '',
    facebookWebhookVerifyToken: '',
    facebookPageAccessToken: '',
  })

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/integrations/facebook/config')
      
      if (!response.ok) {
        console.error('Failed to fetch Facebook config')
        return
      }
      
      const data = await response.json()
      
      if (data.config) {
        setConfig({
          facebookAppId: data.config.facebookAppId || '',
          facebookAppSecret: data.config.facebookAppSecret || '',
          facebookWebhookVerifyToken: data.config.facebookWebhookVerifyToken || '',
          facebookPageAccessToken: data.config.facebookPageAccessToken || '',
        })
      }
    } catch (error) {
      console.error('Error fetching Facebook config:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      
      // Validate required fields
      if (!config.facebookAppId || !config.facebookAppSecret) {
        toast({
          title: 'Validation Error',
          description: 'Facebook App ID and App Secret are required',
          variant: 'destructive',
        })
        return
      }

      // Validate App ID format (should be 15-20 digits)
      const trimmedAppId = config.facebookAppId.trim()
      if (!/^\d{15,20}$/.test(trimmedAppId)) {
        toast({
          title: 'Validation Error',
          description: 'Facebook App ID should be 15-20 digits (numeric only)',
          variant: 'destructive',
        })
        return
      }
      
      const response = await fetch('/api/integrations/facebook/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save configuration')
      }

      toast({
        title: 'Success',
        description: 'Facebook configuration saved successfully',
      })

      fetchConfig() // Refresh config
    } catch (error: any) {
      console.error('Error saving Facebook config:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to save configuration',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card className="border border-gray-200 shadow-sm">
        <CardContent className="py-8">
          <div className="text-center text-gray-500">Loading configuration...</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
            <Facebook className="h-6 w-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-h3">Facebook Configuration</CardTitle>
            <CardDescription>
              Configure Facebook App credentials for Facebook integration
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="facebookAppId">Facebook App ID *</Label>
            <Input
              id="facebookAppId"
              type="text"
              value={config.facebookAppId}
              onChange={(e) => setConfig({ ...config, facebookAppId: e.target.value })}
              placeholder="123456789012345"
            />
            <p className="text-xs text-gray-500">
              Your Facebook App ID (15-20 digits, found in Facebook Developer Console)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="facebookAppSecret">Facebook App Secret *</Label>
            <div className="relative">
              <Input
                id="facebookAppSecret"
                type={showPasswords.appSecret ? 'text' : 'password'}
                value={config.facebookAppSecret}
                onChange={(e) => setConfig({ ...config, facebookAppSecret: e.target.value })}
                placeholder="Enter your Facebook App Secret"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPasswords({ ...showPasswords, appSecret: !showPasswords.appSecret })}
              >
                {showPasswords.appSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Your Facebook App Secret (found in Facebook Developer Console → Settings → Basic)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="facebookWebhookVerifyToken">Webhook Verify Token</Label>
            <div className="relative">
              <Input
                id="facebookWebhookVerifyToken"
                type={showPasswords.webhookToken ? 'text' : 'password'}
                value={config.facebookWebhookVerifyToken}
                onChange={(e) => setConfig({ ...config, facebookWebhookVerifyToken: e.target.value })}
                placeholder="fb_verify_2025"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPasswords({ ...showPasswords, webhookToken: !showPasswords.webhookToken })}
              >
                {showPasswords.webhookToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Webhook verification token for Facebook webhook (default: fb_verify_2025). Must match the token configured in Facebook Developer Console.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="facebookPageAccessToken">Facebook Page Access Token</Label>
            <div className="relative">
              <Input
                id="facebookPageAccessToken"
                type={showPasswords.pageAccessToken ? 'text' : 'password'}
                value={config.facebookPageAccessToken}
                onChange={(e) => setConfig({ ...config, facebookPageAccessToken: e.target.value })}
                placeholder="Enter your Facebook Page Access Token"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPasswords({ ...showPasswords, pageAccessToken: !showPasswords.pageAccessToken })}
              >
                {showPasswords.pageAccessToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Your Facebook Page Access Token. This token is used to interact with your Facebook Page (send messages, post updates, etc.). You can get this from Facebook Developer Console → Tools → Graph API Explorer.
            </p>
          </div>
        </div>

        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Facebook Setup Instructions</h4>
          <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
            <li>Go to <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="underline">Facebook Developer Console</a></li>
            <li>Create a new app or select an existing app</li>
            <li>Go to Settings → Basic to find your App ID and App Secret</li>
            <li>Add Facebook Login product to your app</li>
            <li>Configure OAuth Redirect URI: <code className="bg-blue-100 px-1 rounded">https://yourdomain.com/api/facebook/callback</code></li>
            <li>Configure Webhook URL: <code className="bg-blue-100 px-1 rounded">https://yourdomain.com/webhooks/facebook</code></li>
            <li>Set Webhook Verify Token to match the token above</li>
          </ol>
        </div>

        <div className="pt-4 border-t border-gray-200">
          <Button
            className="bg-primary hover:bg-primary-dark text-white"
            onClick={handleSave}
            disabled={saving}
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

