'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { useStore } from '@/lib/store-context'
import { Save } from 'lucide-react'

const TIMEZONES = [
  { value: 'America/New_York', label: 'America/New_York (EST)' },
  { value: 'America/Chicago', label: 'America/Chicago (CST)' },
  { value: 'America/Denver', label: 'America/Denver (MST)' },
  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (PST)' },
  { value: 'America/Phoenix', label: 'America/Phoenix (MST)' },
  { value: 'America/Anchorage', label: 'America/Anchorage (AKST)' },
  { value: 'Pacific/Honolulu', label: 'Pacific/Honolulu (HST)' },
  { value: 'UTC', label: 'UTC' },
  { value: 'Europe/London', label: 'Europe/London (GMT)' },
  { value: 'Europe/Paris', label: 'Europe/Paris (CET)' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEDT)' },
]

const TIME_OPTIONS = [
  '12:00 AM', '12:30 AM', '1:00 AM', '1:30 AM', '2:00 AM', '2:30 AM',
  '3:00 AM', '3:30 AM', '4:00 AM', '4:30 AM', '5:00 AM', '5:30 AM',
  '6:00 AM', '6:30 AM', '7:00 AM', '7:30 AM', '8:00 AM', '8:30 AM',
  '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM', '11:00 AM', '11:30 AM',
  '12:00 PM', '12:30 PM', '1:00 PM', '1:30 PM', '2:00 PM', '2:30 PM',
  '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM', '5:30 PM',
  '6:00 PM', '6:30 PM', '7:00 PM', '7:30 PM', '8:00 PM', '8:30 PM',
  '9:00 PM', '9:30 PM', '10:00 PM', '10:30 PM', '11:00 PM', '11:30 PM',
]

const DAYS_OF_WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

interface BusinessHours {
  [key: string]: {
    enabled: boolean
    startTime: string
    endTime: string
  }
}

export function GeneralSettings() {
  const { toast } = useToast()
  const { selectedStoreId } = useStore()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [settings, setSettings] = useState({
    companyName: '',
    supportEmail: '',
    timezone: 'America/New_York',
    businessHours: {} as BusinessHours,
  })

  useEffect(() => {
    fetchSettings()
  }, [selectedStoreId]) // Refetch when store changes

  const fetchSettings = async () => {
    try {
      setLoading(true)
      const url = selectedStoreId 
        ? `/api/settings/general?storeId=${selectedStoreId}`
        : '/api/settings/general'
      const response = await fetch(url)
      
      if (!response.ok) {
        console.error('Failed to fetch general settings')
        // Initialize with defaults
        initializeDefaults()
        return
      }
      
      const data = await response.json()
      
      if (data.settings) {
        setSettings({
          companyName: data.settings.companyName || '',
          supportEmail: data.settings.supportEmail || '',
          timezone: data.settings.timezone || 'America/New_York',
          businessHours: data.settings.businessHours || initializeBusinessHours(),
        })
      } else {
        initializeDefaults()
      }
    } catch (error) {
      console.error('Error fetching general settings:', error)
      initializeDefaults()
    } finally {
      setLoading(false)
    }
  }

  const initializeDefaults = () => {
    setSettings({
      companyName: 'Shipowl Support',
      supportEmail: 'support@company.com',
      timezone: 'America/New_York',
      businessHours: initializeBusinessHours(),
    })
  }

  const initializeBusinessHours = (): BusinessHours => {
    const hours: BusinessHours = {}
    DAYS_OF_WEEK.forEach((day) => {
      hours[day] = {
        enabled: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].includes(day),
        startTime: '9:00 AM',
        endTime: '5:00 PM',
      }
    })
    return hours
  }

  const handleBusinessHoursChange = (day: string, field: 'enabled' | 'startTime' | 'endTime', value: string | boolean) => {
    setSettings({
      ...settings,
      businessHours: {
        ...settings.businessHours,
        [day]: {
          ...settings.businessHours[day],
          [field]: value,
        },
      },
    })
  }

  const handleSave = async () => {
    try {
      setSaving(true)
      
      // Validate required fields
      if (!settings.companyName || !settings.supportEmail) {
        toast({
          title: 'Validation Error',
          description: 'Company Name and Support Email are required',
          variant: 'destructive',
        })
        return
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
      if (!emailRegex.test(settings.supportEmail)) {
        toast({
          title: 'Validation Error',
          description: 'Please enter a valid email address',
          variant: 'destructive',
        })
        return
      }

      const response = await fetch('/api/settings/general', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...settings,
          storeId: selectedStoreId, // Include storeId in save request
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save settings')
      }

      toast({
        title: 'Success',
        description: 'General settings saved successfully',
      })

      fetchSettings() // Refresh settings
    } catch (error: any) {
      console.error('Error saving general settings:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Card className="border border-gray-200 shadow-sm">
        <CardContent className="p-6">
          <div className="text-center text-gray-500">Loading settings...</div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border border-gray-200 shadow-sm">
      <CardHeader>
        <CardTitle className="text-h3">General Settings</CardTitle>
        <CardDescription>Configure your company information and business hours</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="space-y-2">
          <Label htmlFor="company-name">Company Name *</Label>
          <Input
            id="company-name"
            value={settings.companyName}
            onChange={(e) => setSettings({ ...settings, companyName: e.target.value })}
            placeholder="Shipowl Support"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="support-email">Support Email *</Label>
          <Input
            id="support-email"
            type="email"
            value={settings.supportEmail}
            onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
            placeholder="support@company.com"
          />
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="timezone">Timezone</Label>
          <select
            id="timezone"
            value={settings.timezone}
            onChange={(e) => setSettings({ ...settings, timezone: e.target.value })}
            className="flex h-10 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
          >
            {TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
        
        <div className="space-y-4">
          <Label>Business Hours</Label>
          <div className="space-y-3">
            {DAYS_OF_WEEK.map((day) => (
              <div key={day} className="flex items-center gap-3">
                <div className="flex items-center gap-2 w-32">
                  <input
                    type="checkbox"
                    id={`${day}-enabled`}
                    checked={settings.businessHours[day]?.enabled || false}
                    onChange={(e) => handleBusinessHoursChange(day, 'enabled', e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <Label htmlFor={`${day}-enabled`} className="text-sm text-gray-600 cursor-pointer">
                    {day}
                  </Label>
                </div>
                {settings.businessHours[day]?.enabled && (
                  <>
                    <select
                      value={settings.businessHours[day]?.startTime || '9:00 AM'}
                      onChange={(e) => handleBusinessHoursChange(day, 'startTime', e.target.value)}
                      className="flex h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                    <span className="text-sm text-gray-600">to</span>
                    <select
                      value={settings.businessHours[day]?.endTime || '5:00 PM'}
                      onChange={(e) => handleBusinessHoursChange(day, 'endTime', e.target.value)}
                      className="flex h-10 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm"
                    >
                      {TIME_OPTIONS.map((time) => (
                        <option key={time} value={time}>
                          {time}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        
        <Button 
          onClick={handleSave}
          disabled={saving}
          className="bg-primary hover:bg-primary-dark text-white"
        >
          <Save className="h-4 w-4 mr-2" />
          {saving ? 'Saving...' : 'Save Changes'}
        </Button>
      </CardContent>
    </Card>
  )
}
