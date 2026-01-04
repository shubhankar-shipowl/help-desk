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
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/ui/use-toast'

interface EditAutoAcknowledgmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditAutoAcknowledgmentDialog({
  open,
  onOpenChange,
}: EditAutoAcknowledgmentDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [template, setTemplate] = useState('TICKET_CREATED')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // TODO: Save to database or configuration
      // For now, just show success message
      await new Promise(resolve => setTimeout(resolve, 500))

      toast({
        title: 'Success',
        description: 'Auto-acknowledgment settings updated successfully',
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
          <DialogTitle>Edit Auto-send Acknowledgment</DialogTitle>
          <DialogDescription>
            Configure automatic acknowledgment email settings
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-ack-enabled">Enable Auto-send</Label>
                <p className="text-sm text-gray-500">
                  Send confirmation email when ticket is created
                </p>
              </div>
              <Switch
                id="auto-ack-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            {enabled && (
              <div className="space-y-2">
                <Label htmlFor="email-template">Email Template</Label>
                <Select value={template} onValueChange={setTemplate}>
                  <SelectTrigger id="email-template">
                    <SelectValue placeholder="Select template" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="TICKET_CREATED">New Ticket Created</SelectItem>
                    <SelectItem value="TICKET_REPLY">Ticket Reply</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  Select the email template to use for acknowledgment emails
                </p>
              </div>
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

