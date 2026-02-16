'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/use-toast'
import { Phone, CheckCircle2 } from 'lucide-react'

interface AgentPhoneConfigProps {
  userPhone: string | null | undefined
  userId: string
  isOpen: boolean
  onClose: () => void
}

export function AgentPhoneConfig({ userPhone, userId, isOpen, onClose }: AgentPhoneConfigProps) {
  const { data: session, update } = useSession()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [phone, setPhone] = useState(userPhone || '')
  const [isConfigured, setIsConfigured] = useState(!!userPhone)

  useEffect(() => {
    setPhone(userPhone || '')
    setIsConfigured(!!userPhone)
  }, [userPhone])

  const validatePhone = (phoneNumber: string): boolean => {
    // Remove all non-digit characters for validation
    const digits = phoneNumber.replace(/\D/g, '')
    
    // Check if it's 10 digits (Indian format) or 10-15 digits with country code
    if (digits.length === 10) {
      return true
    }
    
    // Check if it starts with country code (e.g., +91, 91, etc.)
    if (digits.length >= 10 && digits.length <= 15) {
      return true
    }
    
    return false
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!phone.trim()) {
      toast({
        title: 'Error',
        description: 'Phone number is required',
        variant: 'destructive',
      })
      return
    }

    if (!validatePhone(phone)) {
      toast({
        title: 'Error',
        description: 'Please enter a valid phone number. Format: 10 digits (e.g., 9504785931) or with country code (e.g., +919504785931)',
        variant: 'destructive',
      })
      return
    }

    setIsLoading(true)

    try {
      // Use session user ID to ensure we're updating the correct user
      const targetUserId = session?.user?.id || userId
      
      if (!targetUserId) {
        throw new Error('User ID not found. Please refresh the page and try again.')
      }

      const response = await fetch(`/api/users/${targetUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: phone.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to save phone number')
      }

      // Update session
      await update()

      setIsConfigured(true)
      
      toast({
        title: 'Success',
        description: 'Agent phone number configured successfully',
      })

      // Close modal after successful save
      setTimeout(() => {
        onClose()
      }, 1000)
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save phone number',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Handle dialog open/close state
  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent 
        className="sm:max-w-[500px]"
      >
        <DialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <Phone className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <DialogTitle className="text-xl">Exotel Settings</DialogTitle>
              <DialogDescription className="mt-1">
                {!isConfigured 
                  ? 'Phone number configuration is recommended to use calling features. You can configure it later from settings.'
                  : 'Configure your agent phone number to enable calling features'
                }
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {isConfigured && (
            <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <span className="text-sm text-green-700">
                Agent number configured: {phone}
              </span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="agent-phone" className="text-base font-semibold">
                Your Agent Phone Number
              </Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  id="agent-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="pl-10 h-11"
                  placeholder="9821474604"
                  disabled={isLoading}
                />
              </div>
              <p className="text-xs text-gray-500 mt-1">
                This is your phone number that will be used when making calls. Format: 10 digits (e.g., 9504785931) or with country code (e.g., +919504785931)
              </p>
            </div>

            <Button 
              type="submit" 
              disabled={isLoading || !phone.trim()}
              className="w-full h-11"
            >
              {isLoading ? (
                <>Saving...</>
              ) : isConfigured ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Update Agent Number
                </>
              ) : (
                <>
                  <Phone className="h-4 w-4 mr-2" />
                  Save Agent Number
                </>
              )}
            </Button>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

