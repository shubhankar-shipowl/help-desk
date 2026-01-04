'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Mail, Save, Eye, EyeOff } from 'lucide-react'

export function EmailConfig() {
  const { toast } = useToast()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [config, setConfig] = useState({
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPassword: '',
  })

  useEffect(() => {
    fetchConfig()
  }, [])

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/integrations/email/config')
      
      if (!response.ok) {
        console.error('Failed to fetch email config')
        return
      }
      
      const data = await response.json()
      
      if (data.config) {
        setConfig({
          smtpHost: data.config.smtpHost || '',
          smtpPort: data.config.smtpPort || '587',
          smtpUser: data.config.smtpUser || '',
          smtpPassword: data.config.smtpPassword || '',
        })
      }
    } catch (error) {
      console.error('Error fetching email config:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      
      // Validate required fields
      if (!config.smtpHost || !config.smtpPort || !config.smtpUser || !config.smtpPassword) {
        toast({
          title: 'Validation Error',
          description: 'All fields are required',
          variant: 'destructive',
        })
        return
      }

      // Validate port is a number
      const port = parseInt(config.smtpPort)
      if (isNaN(port) || port < 1 || port > 65535) {
        toast({
          title: 'Validation Error',
          description: 'SMTP Port must be a valid number between 1 and 65535',
          variant: 'destructive',
        })
        return
      }
      
      const response = await fetch('/api/integrations/email/config', {
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
        description: 'Email configuration saved successfully',
      })

      fetchConfig() // Refresh config
    } catch (error: any) {
      console.error('Error saving email config:', error)
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
            <Mail className="h-6 w-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-h3">Email (SMTP) Configuration</CardTitle>
            <CardDescription>
              Configure SMTP settings for sending email notifications
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="smtpHost">SMTP Host *</Label>
            <Input
              id="smtpHost"
              type="text"
              value={config.smtpHost}
              onChange={(e) => setConfig({ ...config, smtpHost: e.target.value })}
              placeholder="smtp.gmail.com"
            />
            <p className="text-xs text-gray-500">
              Your SMTP server hostname (e.g., smtp.gmail.com, smtp.outlook.com)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtpPort">SMTP Port *</Label>
            <Input
              id="smtpPort"
              type="number"
              value={config.smtpPort}
              onChange={(e) => setConfig({ ...config, smtpPort: e.target.value })}
              placeholder="587"
              min="1"
              max="65535"
            />
            <p className="text-xs text-gray-500">
              SMTP server port (587 for TLS, 465 for SSL, 25 for unencrypted)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtpUser">SMTP Username/Email *</Label>
            <Input
              id="smtpUser"
              type="email"
              value={config.smtpUser}
              onChange={(e) => setConfig({ ...config, smtpUser: e.target.value })}
              placeholder="your-email@example.com"
            />
            <p className="text-xs text-gray-500">
              Your email address or SMTP username
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="smtpPassword">SMTP Password *</Label>
            <div className="relative">
              <Input
                id="smtpPassword"
                type={showPassword ? 'text' : 'password'}
                value={config.smtpPassword}
                onChange={(e) => setConfig({ ...config, smtpPassword: e.target.value })}
                placeholder="Enter your SMTP password or app password"
                className="pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3"
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              Your SMTP password or app-specific password (for Gmail, use App Password)
            </p>
          </div>
        </div>

        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Gmail Setup Instructions</h4>
          <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
            <li>Enable 2-Step Verification on your Google account</li>
            <li>Go to Google Account → Security → 2-Step Verification → App passwords</li>
            <li>Generate a password for &quot;Mail&quot;</li>
            <li>Use this App Password as your SMTP Password</li>
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

