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
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'

interface NewEmailTemplateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const templateTypes = [
  { value: 'EMAIL_TICKET_CREATED', label: 'New Ticket', description: 'Sent when a new ticket is created' },
  { value: 'EMAIL_TICKET_ASSIGNED', label: 'Ticket Assigned', description: 'Sent when ticket is assigned to agent' },
  { value: 'EMAIL_TICKET_REPLY', label: 'Ticket Reply', description: 'Sent when agent replies to ticket' },
  { value: 'EMAIL_TICKET_RESOLVED', label: 'Ticket Resolved', description: 'Sent when ticket is resolved' },
  { value: 'EMAIL_TICKET_STATUS_CHANGED', label: 'Ticket Status Changed', description: 'Sent when ticket status changes' },
  { value: 'EMAIL_CUSTOM', label: 'Custom Template', description: 'Custom email template' },
]

export function NewEmailTemplateDialog({
  open,
  onOpenChange,
}: NewEmailTemplateDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    type: '',
    subject: '',
    htmlTemplate: '',
  })

  const selectedTemplateType = templateTypes.find((t) => t.value === formData.type)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    if (!formData.type) {
      toast({
        title: 'Error',
        description: 'Please select a template type',
        variant: 'destructive',
      })
      setLoading(false)
      return
    }

    try {
      // Check if template already exists
      const checkResponse = await fetch(`/api/notification-templates?type=${formData.type}&channel=EMAIL`)
      const checkData = await checkResponse.json()
      
      if (checkData.templates && checkData.templates.length > 0) {
        toast({
          title: 'Template Already Exists',
          description: 'A template with this type already exists. Please edit it instead.',
          variant: 'destructive',
        })
        setLoading(false)
        return
      }

      const response = await fetch('/api/notification-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: formData.type,
          channel: 'EMAIL',
          subject: formData.subject,
          htmlTemplate: formData.htmlTemplate,
          bodyTemplate: formData.htmlTemplate.replace(/<[^>]*>/g, ''), // Strip HTML for plain text
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create template')
      }

      toast({
        title: 'Success',
        description: 'Email template created successfully',
      })

      router.refresh()
      onOpenChange(false)
      // Reset form
      setFormData({
        type: '',
        subject: '',
        htmlTemplate: '',
      })
    } catch (error: any) {
      console.error('Error creating template:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to create template',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Email Template</DialogTitle>
          <DialogDescription>Create a new email template for automated notifications</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="template-type">Template Type *</Label>
              <Select
                value={formData.type}
                onValueChange={(value) => setFormData({ ...formData, type: value })}
                required
              >
                <SelectTrigger id="template-type">
                  <SelectValue placeholder="Select template type" />
                </SelectTrigger>
                <SelectContent>
                  {templateTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      <div>
                        <div className="font-medium">{type.label}</div>
                        <div className="text-xs text-gray-500">{type.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTemplateType && (
                <p className="text-xs text-gray-500">{selectedTemplateType.description}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-subject">Email Subject *</Label>
              <Input
                id="template-subject"
                value={formData.subject}
                onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                required
                placeholder="e.g., Ticket Created Successfully - {{TICKET_ID}}"
              />
              <p className="text-xs text-gray-500">
                Use variables like {'{{TICKET_ID}}'}, {'{{CUSTOMER_NAME}}'}, etc.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="template-html">HTML Template *</Label>
              <Textarea
                id="template-html"
                value={formData.htmlTemplate}
                onChange={(e) => setFormData({ ...formData, htmlTemplate: e.target.value })}
                required
                placeholder="Enter HTML email template..."
                className="min-h-[400px] font-mono text-sm"
              />
              <p className="text-xs text-gray-500">
                Use HTML format. Variables: {'{{TICKET_ID}}'}, {'{{CUSTOMER_NAME}}'}, {'{{TICKET_SUBJECT}}'}, etc.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                onOpenChange(false)
                setFormData({
                  type: '',
                  subject: '',
                  htmlTemplate: '',
                })
              }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

