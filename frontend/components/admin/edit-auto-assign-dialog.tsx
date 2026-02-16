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

interface EditAutoAssignDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditAutoAssignDialog({
  open,
  onOpenChange,
}: EditAutoAssignDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [enabled, setEnabled] = useState(true)
  const [method, setMethod] = useState('round-robin')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      // TODO: Save to database or configuration
      // For now, just show success message
      await new Promise(resolve => setTimeout(resolve, 500))

      toast({
        title: 'Success',
        description: 'Auto-assign settings updated successfully',
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
          <DialogTitle>Edit Auto-assign Tickets</DialogTitle>
          <DialogDescription>
            Configure automatic ticket assignment settings
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="auto-assign-enabled">Enable Auto-assign</Label>
                <p className="text-sm text-gray-500">
                  Automatically assign new tickets to available agents
                </p>
              </div>
              <Switch
                id="auto-assign-enabled"
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>

            {enabled && (
              <div className="space-y-2">
                <Label htmlFor="assignment-method">Assignment Method</Label>
                <Select value={method} onValueChange={setMethod}>
                  <SelectTrigger id="assignment-method">
                    <SelectValue placeholder="Select method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="round-robin">Round-robin (Balance workload)</SelectItem>
                    <SelectItem value="least-assigned">Least Assigned (Fewest tickets)</SelectItem>
                    <SelectItem value="category-based">Category-based (Match expertise)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-gray-500">
                  {method === 'round-robin' && 'Distributes tickets evenly among all agents'}
                  {method === 'least-assigned' && 'Assigns to agent with fewest open tickets'}
                  {method === 'category-based' && 'Assigns based on category expertise'}
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

