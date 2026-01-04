'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'

interface FacebookIntegration {
  id: string
  pageId: string
  pageName: string
  isActive: boolean
  createdAt?: string | Date
  notificationSettings?: {
    posts: boolean
    comments: boolean
    messages: boolean
    mentions: boolean
  }
  autoCreateSettings?: {
    fromMessages: boolean
    fromComments: boolean
    keywords: string
  }
}

export function IntegrationsSection() {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [integration, setIntegration] = useState<FacebookIntegration | null>(null)
  
  // Notification settings
  const [notifyPosts, setNotifyPosts] = useState(true)
  const [notifyComments, setNotifyComments] = useState(true)
  const [notifyMessages, setNotifyMessages] = useState(true)
  const [notifyMentions, setNotifyMentions] = useState(true)
  
  // Auto-create settings
  const [createFromMessages, setCreateFromMessages] = useState(true)
  const [createFromComments, setCreateFromComments] = useState(false)
  const [keywords, setKeywords] = useState('support, help, issue')

  useEffect(() => {
    fetchIntegration()
  }, [])

  const fetchIntegration = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/facebook/integration')
      
      if (!response.ok) {
        console.error('Failed to fetch integration:', response.status, response.statusText)
        return
      }
      
      const data = await response.json()
      
      if (data.error) {
        console.error('API error:', data.error)
        return
      }
      
      if (data.integration) {
        setIntegration(data.integration)
        
        // Set notification settings
        if (data.integration.notificationSettings) {
          setNotifyPosts(data.integration.notificationSettings.posts ?? true)
          setNotifyComments(data.integration.notificationSettings.comments ?? true)
          setNotifyMessages(data.integration.notificationSettings.messages ?? true)
          setNotifyMentions(data.integration.notificationSettings.mentions ?? true)
        }
        
        // Set auto-create settings
        if (data.integration.autoCreateSettings) {
          setCreateFromMessages(data.integration.autoCreateSettings.fromMessages ?? true)
          setCreateFromComments(data.integration.autoCreateSettings.fromComments ?? false)
          setKeywords(data.integration.autoCreateSettings.keywords || 'support, help, issue')
        }
      } else {
        console.log('No integration found in response')
      }
    } catch (error) {
      console.error('Error fetching integration:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      
      const response = await fetch('/api/facebook/integration/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          notificationSettings: {
            posts: notifyPosts,
            comments: notifyComments,
            messages: notifyMessages,
            mentions: notifyMentions,
          },
          autoCreateSettings: {
            fromMessages: createFromMessages,
            fromComments: createFromComments,
            keywords: keywords,
          },
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save settings')
      }

      toast({
        title: 'Success',
        description: 'Facebook integration settings saved successfully',
      })

      router.refresh()
      fetchIntegration() // Refresh integration data
    } catch (error: any) {
      console.error('Error saving settings:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDisconnect = async () => {
    if (!confirm('Are you sure you want to disconnect the Facebook integration?')) {
      return
    }

    try {
      setSaving(true)
      const response = await fetch('/api/facebook/integration/disconnect', {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to disconnect')
      }

      toast({
        title: 'Success',
        description: 'Facebook integration disconnected successfully',
      })

      router.refresh()
      setIntegration(null)
    } catch (error: any) {
      console.error('Error disconnecting:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to disconnect',
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
          <div className="text-center text-gray-500">Loading integration...</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-h3">Facebook Integration</CardTitle>
        <CardDescription>Connect your Facebook page to create tickets from messages</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {integration ? (
          <>
            {/* Connected Page Info */}
            <div className="p-4 border border-gray-200 rounded-lg">
              <div className="flex items-center gap-4 mb-4">
                <div className="w-16 h-16 bg-blue-100 rounded-lg flex items-center justify-center">
                  <span className="text-2xl">📘</span>
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-semibold">{integration.pageName}</h4>
                    {integration.isActive ? (
                      <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">Active</span>
                    ) : (
                      <span className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded">Inactive</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">Page ID: {integration.pageId}</p>
                  <p className="text-xs text-gray-500">
                    Connected: {integration.createdAt ? new Date(integration.createdAt).toLocaleDateString() : 'Unknown'}
                  </p>
                </div>
                <Button 
                  variant="outline" 
                  onClick={handleDisconnect}
                  disabled={saving}
                >
                  Disconnect
                </Button>
              </div>
            </div>

            {/* Notification Settings */}
            <div className="space-y-4">
              <h4 className="font-semibold">Notification Settings</h4>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifyPosts}
                    onChange={(e) => setNotifyPosts(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">New posts on page</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifyComments}
                    onChange={(e) => setNotifyComments(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">New comments on posts</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifyMessages}
                    onChange={(e) => setNotifyMessages(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Direct messages</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={notifyMentions}
                    onChange={(e) => setNotifyMentions(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Page mentions</span>
                </label>
              </div>
            </div>

            {/* Auto-create Tickets */}
            <div className="space-y-4">
              <h4 className="font-semibold">Auto-create Tickets</h4>
              <div className="space-y-2">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createFromMessages}
                    onChange={(e) => setCreateFromMessages(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Create ticket from direct messages</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createFromComments}
                    onChange={(e) => setCreateFromComments(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <span className="text-sm">Create ticket from comments (with keyword)</span>
                </label>
                {createFromComments && (
                  <div className="ml-6 space-y-2">
                    <Label htmlFor="keywords" className="text-sm">Trigger Keywords:</Label>
                    <Input
                      id="keywords"
                      value={keywords}
                      onChange={(e) => setKeywords(e.target.value)}
                      placeholder="support, help, issue"
                    />
                    <p className="text-xs text-gray-500">
                      Comma-separated keywords that trigger ticket creation from comments
                    </p>
                  </div>
                )}
              </div>
            </div>

            <Button
              className="bg-primary hover:bg-primary-dark text-white"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Settings'}
            </Button>
          </>
        ) : (
          <div className="text-center py-8">
            <p className="text-gray-600 mb-4">No Facebook page connected</p>
            <Button
              className="bg-primary hover:bg-primary-dark text-white"
              onClick={async () => {
                try {
                  setSaving(true)
                  const response = await fetch('/api/facebook/connect')
                  const data = await response.json()
                  
                  if (data.error) {
                    toast({
                      title: 'Error',
                      description: data.error,
                      variant: 'destructive',
                    })
                    return
                  }
                  
                  if (data.authUrl) {
                    // Redirect to Facebook OAuth
                    window.location.href = data.authUrl
                  } else {
                    toast({
                      title: 'Error',
                      description: 'Failed to get Facebook authorization URL',
                      variant: 'destructive',
                    })
                  }
                } catch (error: any) {
                  console.error('Error connecting to Facebook:', error)
                  toast({
                    title: 'Error',
                    description: error.message || 'Failed to connect to Facebook',
                    variant: 'destructive',
                  })
                } finally {
                  setSaving(false)
                }
              }}
              disabled={saving}
            >
              {saving ? 'Connecting...' : 'Connect Facebook Page'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

