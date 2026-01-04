'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'

interface EditAutoResolveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditAutoResolveDialog({
  open,
  onOpenChange,
}: EditAutoResolveDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [days, setDays] = useState('7')
  const [warningDays, setWarningDays] = useState('5')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // TODO: Save to database or configuration
      // For now, just show success message
      await new Promise(resolve => setTimeout(resolve, 500))

      toast({
        title: 'Success',
        description: 'Auto-resolve settings updated successfully',
      })

      router.refresh()
      onOpenChange(false)
    } catch (error: any) {
      console.error('Error saving settings:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to save settings',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Auto-resolve Inactive Tickets</DialogTitle>
          <DialogDescription>
            Configure automatic ticket resolution for inactive tickets
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-resolve-enabled">Enable Auto-resolve</Label>
                <p className="text-sm text-gray-500">
                  Automatically resolve tickets with no response
                </p>
              </div>
              <Switch
                id="auto-resolve-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            {enabled && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="resolve-days">Days Before Resolution</Label>
                  <Input
                    id="resolve-days"
                    type="number"
                    min="1"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    required
                  />
                  <p className="text-xs text-gray-500">
                    Tickets with no response will be resolved after this many days
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="warning-days">Send Warning Before (Days)</Label>
                  <Input
                    id="warning-days"
                    type="number"
                    min="0"
                    max={parseInt(days) - 1}
                    value={warningDays}
                    onChange={(e) => setWarningDays(e.target.value)}
                    required
                  />
                  <p className="text-xs text-gray-500">
                    Send warning email this many days before auto-resolving
                  </p>
                </div>
              </>
            )}
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save Settings'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

