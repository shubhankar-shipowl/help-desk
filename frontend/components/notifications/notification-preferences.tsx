'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { Bell, Mail, Smartphone, Facebook } from 'lucide-react'

interface NotificationPreference {
  notificationType: string
  inAppEnabled: boolean
  emailEnabled: boolean
  pushEnabled: boolean
  facebookEnabled: boolean
  emailDigest: 'REALTIME' | 'HOURLY' | 'DAILY' | 'WEEKLY'
  quietHoursEnabled: boolean
  quietHoursStart?: string
  quietHoursEnd?: string
}

const notificationTypes = [
  { value: 'TICKET_CREATED', label: 'Ticket Created' },
  { value: 'TICKET_ASSIGNED', label: 'Ticket Assigned' },
  { value: 'TICKET_REPLY', label: 'New Reply' },
  { value: 'TICKET_STATUS_CHANGED', label: 'Status Changed' },
  { value: 'TICKET_MENTION', label: 'Mentions' },
  { value: 'SLA_BREACH', label: 'SLA Breach' },
  { value: 'FACEBOOK_POST', label: 'Facebook Posts' },
  { value: 'FACEBOOK_COMMENT', label: 'Facebook Comments' },
  { value: 'FACEBOOK_MESSAGE', label: 'Facebook Messages' },
]

export function NotificationPreferences() {
  const { toast } = useToast()
  const [preferences, setPreferences] = useState<Record<string, NotificationPreference>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchPreferences()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchPreferences = async () => {
    try {
      const response = await fetch('/api/notifications/preferences')
      const data = await response.json()
      
      if (data.preferences) {
        const prefsMap: Record<string, NotificationPreference> = {}
        data.preferences.forEach((pref: NotificationPreference) => {
          prefsMap[pref.notificationType] = pref
        })
        setPreferences(prefsMap)
      }
    } catch (error) {
      console.error('Error fetching preferences:', error)
      toast({
        title: 'Error',
        description: 'Failed to load notification preferences',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const updatePreference = async (
    notificationType: string,
    updates: Partial<NotificationPreference>
  ) => {
    setSaving(true)
    try {
      const response = await fetch('/api/notifications/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notificationType,
          ...updates,
        }),
      })

      const data = await response.json()
      
      if (data.success) {
        setPreferences((prev) => ({
          ...prev,
          [notificationType]: {
            ...prev[notificationType],
            ...updates,
          },
        }))
        toast({
          title: 'Success',
          description: 'Preferences updated',
        })
      }
    } catch (error) {
      console.error('Error updating preference:', error)
      toast({
        title: 'Error',
        description: 'Failed to update preferences',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const getPreference = (type: string): NotificationPreference => {
    return preferences[type] || {
      notificationType: type,
      inAppEnabled: true,
      emailEnabled: true,
      pushEnabled: false,
      facebookEnabled: false,
      emailDigest: 'REALTIME',
      quietHoursEnabled: false,
    }
  }

  if (loading) {
    return <div className="text-center py-8">Loading preferences...</div>
  }

  return (
    <div className="space-y-6">
      {notificationTypes.map((type) => {
        const pref = getPreference(type.value)
        return (
          <Card key={type.value} className="border border-gray-200">
            <CardHeader>
              <CardTitle className="text-lg">{type.label}</CardTitle>
              <CardDescription>
                Configure how you receive {type.label.toLowerCase()} notifications
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* In-App */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Bell className="h-5 w-5 text-gray-400" />
                  <Label htmlFor={`${type.value}-inapp`}>In-App Notifications</Label>
                </div>
                <Switch
                  id={`${type.value}-inapp`}
                  checked={pref.inAppEnabled}
                  disabled={true}
                  onCheckedChange={() => {}}
                />
                <span className="text-xs text-gray-500">Always enabled</span>
              </div>

              {/* Email */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-gray-400" />
                  <Label htmlFor={`${type.value}-email`}>Email Notifications</Label>
                </div>
                <Switch
                  id={`${type.value}-email`}
                  checked={pref.emailEnabled}
                  disabled={saving}
                  onCheckedChange={(checked) =>
                    updatePreference(type.value, { emailEnabled: checked })
                  }
                />
              </div>

              {pref.emailEnabled && (
                <div className="ml-8">
                  <Label htmlFor={`${type.value}-digest`}>Email Frequency</Label>
                  <Select
                    value={pref.emailDigest}
                    onValueChange={(value: 'REALTIME' | 'HOURLY' | 'DAILY' | 'WEEKLY') =>
                      updatePreference(type.value, { emailDigest: value })
                    }
                    disabled={saving}
                  >
                    <SelectTrigger id={`${type.value}-digest`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="REALTIME">Real-time</SelectItem>
                      <SelectItem value="HOURLY">Hourly digest</SelectItem>
                      <SelectItem value="DAILY">Daily digest</SelectItem>
                      <SelectItem value="WEEKLY">Weekly digest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Push */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Smartphone className="h-5 w-5 text-gray-400" />
                  <Label htmlFor={`${type.value}-push`}>Push Notifications</Label>
                </div>
                <Switch
                  id={`${type.value}-push`}
                  checked={pref.pushEnabled}
                  disabled={saving}
                  onCheckedChange={(checked) =>
                    updatePreference(type.value, { pushEnabled: checked })
                  }
                />
              </div>

              {/* Facebook (only for Facebook notification types) */}
              {type.value.startsWith('FACEBOOK') && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Facebook className="h-5 w-5 text-gray-400" />
                    <Label htmlFor={`${type.value}-facebook`}>Facebook Notifications</Label>
                  </div>
                  <Switch
                    id={`${type.value}-facebook`}
                    checked={pref.facebookEnabled}
                    disabled={saving}
                    onCheckedChange={(checked) =>
                      updatePreference(type.value, { facebookEnabled: checked })
                    }
                  />
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}

      {/* Global Quiet Hours */}
      <Card className="border border-gray-200">
        <CardHeader>
          <CardTitle className="text-lg">Quiet Hours</CardTitle>
          <CardDescription>
            Set time windows when only critical notifications are sent
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label htmlFor="quiet-hours-enabled">Enable Quiet Hours</Label>
            <Switch
              id="quiet-hours-enabled"
              checked={preferences['TICKET_CREATED']?.quietHoursEnabled || false}
              disabled={saving}
              onCheckedChange={(checked) => {
                // Apply to all notification types
                notificationTypes.forEach((type) => {
                  updatePreference(type.value, { quietHoursEnabled: checked })
                })
              }}
            />
          </div>
          {(preferences['TICKET_CREATED']?.quietHoursEnabled || false) && (
            <div className="grid grid-cols-2 gap-4 ml-8">
              <div>
                <Label htmlFor="quiet-start">Start Time</Label>
                <input
                  id="quiet-start"
                  type="time"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={preferences['TICKET_CREATED']?.quietHoursStart || '22:00'}
                  onChange={(e) => {
                    notificationTypes.forEach((type) => {
                      updatePreference(type.value, { quietHoursStart: e.target.value })
                    })
                  }}
                  disabled={saving}
                />
              </div>
              <div>
                <Label htmlFor="quiet-end">End Time</Label>
                <input
                  id="quiet-end"
                  type="time"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  value={preferences['TICKET_CREATED']?.quietHoursEnd || '08:00'}
                  onChange={(e) => {
                    notificationTypes.forEach((type) => {
                      updatePreference(type.value, { quietHoursEnd: e.target.value })
                    })
                  }}
                  disabled={saving}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

