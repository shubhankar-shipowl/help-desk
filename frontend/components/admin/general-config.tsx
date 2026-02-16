'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/use-toast'
import { Settings, Save, Phone } from 'lucide-react'
import { useStore } from '@/lib/store-context'

export function GeneralConfig() {
  const { toast } = useToast()
  const { selectedStoreId } = useStore()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [config, setConfig] = useState({
    companyAddress: '',
    supportPhone: '',
  })

  useEffect(() => {
    fetchConfig()
  }, [selectedStoreId]) // Refetch when store changes

  const fetchConfig = async () => {
    try {
      setLoading(true)
      const url = selectedStoreId 
        ? `/api/integrations/general/config?storeId=${selectedStoreId}`
        : '/api/integrations/general/config'
      const response = await fetch(url)
      
      if (!response.ok) {
        console.error('Failed to fetch general config')
        return
      }
      
      const data = await response.json()
      
      if (data.config) {
        setConfig({
          companyAddress: data.config.companyAddress || '',
          supportPhone: data.config.supportPhone || '',
        })
      }
    } catch (error) {
      console.error('Error fetching general config:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      const response = await fetch('/api/integrations/general/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...config,
          storeId: selectedStoreId, // Include storeId in save request
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save configuration')
      }

      toast({
        title: 'Success',
        description: 'General configuration saved successfully',
      })

      fetchConfig() // Refresh config
    } catch (error: any) {
      console.error('Error saving general config:', error)
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
          <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center">
            <Settings className="h-6 w-6 text-gray-600" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-h3">General Configuration</CardTitle>
            <CardDescription>
              Configure company information and support contact details
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="companyAddress">Company Address</Label>
            <Textarea
              id="companyAddress"
              value={config.companyAddress}
              onChange={(e) => setConfig({ ...config, companyAddress: e.target.value })}
              placeholder="123 Main Street, City, State, ZIP Code"
              rows={3}
            />
            <p className="text-xs text-gray-500">
              Your company physical address (used in email templates)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="supportPhone">Support Phone</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
              <Input
                id="supportPhone"
                type="tel"
                value={config.supportPhone}
                onChange={(e) => setConfig({ ...config, supportPhone: e.target.value })}
                placeholder="+1 (555) 123-4567"
                className="pl-10"
              />
            </div>
            <p className="text-xs text-gray-500">
              Support phone number (used in email templates and notifications)
            </p>
          </div>
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

