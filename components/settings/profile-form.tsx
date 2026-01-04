'use client'

import React, { useState } from 'react'
import { useSession } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { User, Mail, Phone, Calendar, CheckCircle2, Edit2 } from 'lucide-react'

interface ProfileFormProps {
  user: {
    id: string
    name: string | null
    email: string
    phone: string | null
    avatar: string | null
    role: string
    createdAt: Date
  }
}

export function ProfileForm({ user }: ProfileFormProps) {
  const { data: session, update } = useSession()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [savedPhone, setSavedPhone] = useState(user.phone || '')
  const [formData, setFormData] = useState({
    name: user.name || '',
    email: user.email,
    phone: user.phone || '',
  })
  const phoneInputRef = React.useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      // Use session user ID to ensure we're updating the correct user
      const targetUserId = session?.user?.id || user.id
      
      if (!targetUserId) {
        throw new Error('User ID not found. Please refresh the page and try again.')
      }

      const response = await fetch(`/api/users/${targetUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          phone: formData.phone,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update profile')
      }

      // Update session
      await update()

      // Update saved phone and formData
      const updatedPhone = data.user?.phone || formData.phone
      setSavedPhone(updatedPhone)
      setFormData({
        ...formData,
        phone: updatedPhone,
      })

      toast({
        title: 'Success',
        description: 'Profile updated successfully',
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update profile',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Personal Information</CardTitle>
          <CardDescription>Update your personal details</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="name"
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="pl-10"
                  placeholder="Your name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  disabled
                  className="pl-10 bg-gray-50"
                />
              </div>
              <p className="text-xs text-gray-500">Email cannot be changed</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">
                Phone {user.role === 'AGENT' || user.role === 'ADMIN' ? <span className="text-red-500">*</span> : ''}
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  ref={phoneInputRef}
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="pl-10"
                  placeholder={user.role === 'AGENT' || user.role === 'ADMIN' ? '9821474604 (Required for calling)' : 'Your phone number'}
                />
              </div>
              {(user.role === 'AGENT' || user.role === 'ADMIN') && (
                <>
                  <p className="text-xs text-gray-500">
                    Required for making calls via Exotel. Format: 10 digits (e.g., 9504785931) or with country code (e.g., +919504785931)
                  </p>
                  {savedPhone && savedPhone.trim() !== '' && (
                    <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded-lg mt-2">
                      <CheckCircle2 className="h-4 w-4 text-green-600 flex-shrink-0" />
                      <span className="text-xs text-green-700">
                        <span className="font-medium">Currently saved number:</span> {savedPhone}
                      </span>
                    </div>
                  )}
                </>
              )}
            </div>

            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Saving...' : 'Save Changes'}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Account Information</CardTitle>
          <CardDescription>Your account details</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium">Role</span>
              </div>
              <span className="text-sm text-gray-600 capitalize">{user.role.toLowerCase()}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium">Member Since</span>
              </div>
              <span className="text-sm text-gray-600">
                {new Date(user.createdAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
            {(user.role === 'AGENT' || user.role === 'ADMIN') && (
              <div className="pt-4 border-t border-gray-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-gray-400" />
                    <span className="text-sm font-medium">Agent Phone Number</span>
                  </div>
                  <div className="flex items-center gap-3">
                    {savedPhone ? (
                      <>
                        <div className="flex items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 text-green-600" />
                          <span className="text-sm text-gray-600 font-medium">{savedPhone}</span>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            phoneInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            phoneInputRef.current?.focus()
                          }}
                          className="h-7 text-xs"
                        >
                          <Edit2 className="h-3.5 w-3.5 mr-1.5" />
                          Update
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="text-sm text-red-600">Not configured</span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            phoneInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                            phoneInputRef.current?.focus()
                          }}
                          className="h-7 text-xs"
                        >
                          <Phone className="h-3.5 w-3.5 mr-1.5" />
                          Configure
                        </Button>
                      </>
                    )}
                  </div>
                </div>
                {savedPhone && (
                  <p className="text-xs text-gray-500 mt-2 ml-6">
                    This number will be used when making calls via Exotel
                  </p>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

