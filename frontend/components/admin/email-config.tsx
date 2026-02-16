'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Mail, Save, Eye, EyeOff, CheckCircle } from 'lucide-react'
import { useStore } from '@/lib/store-context'

export function EmailConfig() {
  const { toast } = useToast()
  const { selectedStoreId } = useStore()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testingImap, setTestingImap] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const [config, setConfig] = useState({
    smtpHost: '',
    smtpPort: '587',
    smtpUser: '',
    smtpPassword: '',
    imapEmail: '',
    imapAppPassword: '',
  })

  useEffect(() => {
    fetchConfig()
  }, [selectedStoreId]) // Refetch when store changes

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const url = selectedStoreId 
        ? `/api/integrations/email/config?storeId=${selectedStoreId}`
        : '/api/integrations/email/config'
      const response = await fetch(url)
      
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
          imapEmail: data.config.imapEmail || '',
          imapAppPassword: data.config.imapAppPassword || '',
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
      
      // Validate required SMTP fields
      if (!config.smtpHost || !config.smtpPort || !config.smtpUser || !config.smtpPassword) {
        toast({
          title: 'Validation Error',
          description: 'All SMTP fields are required',
          variant: 'destructive',
        })
        return
      }

      // IMAP fields are optional but if one is provided, both should be provided
      if ((config.imapEmail && !config.imapAppPassword) || (!config.imapEmail && config.imapAppPassword)) {
        toast({
          title: 'Validation Error',
          description: 'Both IMAP Email and IMAP App Password are required if IMAP is configured',
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
      
      // Trim all values before sending to avoid whitespace issues
      const trimmedConfig = {
        smtpHost: config.smtpHost.trim(),
        smtpPort: config.smtpPort.trim(),
        smtpUser: config.smtpUser.trim(),
        smtpPassword: config.smtpPassword.trim(), // Important: trim password
        imapEmail: config.imapEmail.trim(),
        imapAppPassword: config.imapAppPassword.trim(),
      }

      const response = await fetch('/api/integrations/email/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...trimmedConfig,
          storeId: selectedStoreId, // Include storeId in save request
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        let errorMessage = error.error || 'Failed to save configuration'
        
        // Provide helpful error messages for Gmail authentication issues
        if (errorMessage.includes('EAUTH') || errorMessage.includes('authentication failed') || errorMessage.includes('BadCredentials')) {
          if (config.smtpHost?.includes('gmail.com') || config.smtpUser?.includes('@gmail.com')) {
            errorMessage = 'Gmail authentication failed. Please ensure:\n' +
              '1. You are using an App Password (not your regular Gmail password)\n' +
              '2. 2-Step Verification is enabled on your Google account\n' +
              '3. You have generated an App Password at: https://myaccount.google.com/apppasswords\n' +
              '4. The App Password is correctly entered in the SMTP Password field'
          }
        }
        
        throw new Error(errorMessage)
      }

      toast({
        title: 'Success',
        description: 'Email configuration saved successfully',
      })

      fetchConfig() // Refresh config
    } catch (error: any) {
      console.error('Error saving email config:', error)
      const errorMessage = error.message || 'Failed to save configuration'
      toast({
        title: 'Error',
        description: errorMessage.split('\n').map((line: string, idx: number) => (
          <span key={idx}>
            {line}
            {idx < errorMessage.split('\n').length - 1 && <br />}
          </span>
        )),
        variant: 'destructive',
        duration: 10000, // Show for 10 seconds for longer error messages
      })
    } finally {
      setSaving(false)
    }
  }

  const handleTestImap = async () => {
    if (!selectedStoreId) {
      toast({
        title: 'Error',
        description: 'Please select a store to test IMAP connection',
        variant: 'destructive',
      })
      return
    }

    if (!config.imapEmail || !config.imapAppPassword) {
      toast({
        title: 'Error',
        description: 'Please configure IMAP Email and App Password first',
        variant: 'destructive',
      })
      return
    }

    setTestingImap(true)
    try {
      const response = await fetch('/api/emails/test-imap', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          storeId: selectedStoreId,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'IMAP connection test failed')
      }

      toast({
        title: 'Success',
        description: data.message || 'IMAP connection successful!',
      })
    } catch (error: any) {
      console.error('Error testing IMAP connection:', error)
      toast({
        title: 'IMAP Test Failed',
        description: error.message || 'Failed to test IMAP connection',
        variant: 'destructive',
        duration: 10000,
      })
    } finally {
      setTestingImap(false)
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

          <div className="pt-4 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">IMAP Configuration (Optional)</h3>
            <p className="text-xs text-gray-500 mb-4">
              Configure IMAP settings to fetch emails from Gmail inbox. Leave empty if not needed.
            </p>

            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="imapEmail">Gmail Address (for IMAP)</Label>
                <Input
                  id="imapEmail"
                  type="email"
                  value={config.imapEmail}
                  onChange={(e) => setConfig({ ...config, imapEmail: e.target.value })}
                  placeholder="your-email@gmail.com"
                />
                <p className="text-xs text-gray-500">
                  Your Gmail address for fetching emails via IMAP
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="imapAppPassword">Gmail App Password (for IMAP)</Label>
                <div className="relative">
                  <Input
                    id="imapAppPassword"
                    type={showPassword ? 'text' : 'password'}
                    value={config.imapAppPassword}
                    onChange={(e) => setConfig({ ...config, imapAppPassword: e.target.value })}
                    placeholder="Enter your Gmail App Password"
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
                  Gmail App Password for IMAP access (same as SMTP App Password or create a separate one)
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h4 className="text-sm font-semibold text-blue-900 mb-2">Gmail Setup Instructions</h4>
          <ol className="text-xs text-blue-800 space-y-1 list-decimal list-inside">
            <li>Enable 2-Step Verification on your Google account</li>
            <li>Go to Google Account → Security → 2-Step Verification → App passwords</li>
            <li>Generate a password for &quot;Mail&quot; (or separate passwords for SMTP and IMAP)</li>
            <li>Use this App Password as your SMTP Password</li>
            <li>For IMAP: Use the same App Password or generate a separate one for IMAP access</li>
          </ol>
        </div>

        <div className="pt-4 border-t border-gray-200 flex items-center gap-3">
          <Button
            className="bg-primary hover:bg-primary-dark text-white"
            onClick={handleSave}
            disabled={saving || testingImap}
          >
            <Save className="h-4 w-4 mr-2" />
            {saving ? 'Saving...' : 'Save Configuration'}
          </Button>
          
          {config.imapEmail && config.imapAppPassword && selectedStoreId && (
            <Button
              variant="outline"
              onClick={handleTestImap}
              disabled={saving || testingImap}
            >
              <CheckCircle className="h-4 w-4 mr-2" />
              {testingImap ? 'Testing...' : 'Test IMAP Connection'}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

