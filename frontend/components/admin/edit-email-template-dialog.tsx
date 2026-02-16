'use client'

import { useState, useEffect } from 'react'
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
import { useToast } from '@/components/ui/use-toast'

interface EditEmailTemplateDialogProps {
  template: {
    type: string
    name: string
    description: string
  }
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EditEmailTemplateDialog({
  template,
  open,
  onOpenChange,
}: EditEmailTemplateDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState({
    subject: '',
    htmlTemplate: '',
  })
  const [templateData, setTemplateData] = useState<any>(null)

  // Fetch template data when dialog opens
  useEffect(() => {
    if (open && template.type) {
      fetchTemplate()
    }
  }, [open, template.type])

  const fetchTemplate = async () => {
    try {
      const response = await fetch(`/api/notification-templates?type=${template.type}&channel=EMAIL`)
      const data = await response.json()
      
      if (data.templates && data.templates.length > 0) {
        const tmpl = data.templates[0]
        setTemplateData(tmpl)
        setFormData({
          subject: tmpl.subject || '',
          htmlTemplate: tmpl.htmlTemplate || '',
        })
      } else {
        // Template doesn't exist yet, initialize with defaults
        setTemplateData(null)
        setFormData({
          subject: '',
          htmlTemplate: '',
        })
      }
    } catch (error) {
      console.error('Error fetching template:', error)
      toast({
        title: 'Error',
        description: 'Failed to load template',
        variant: 'destructive',
      })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch('/api/notification-templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: template.type,
          channel: 'EMAIL',
          subject: formData.subject,
          htmlTemplate: formData.htmlTemplate,
          bodyTemplate: formData.htmlTemplate.replace(/<[^>]*>/g, ''), // Strip HTML for plain text
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to save template')
      }

      toast({
        title: 'Success',
        description: 'Email template updated successfully',
      })

      router.refresh()
      onOpenChange(false)
    } catch (error: any) {
      console.error('Error saving template:', error)
      toast({
        title: 'Error',
        description: error.message || 'Failed to save template',
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
          <DialogTitle>Edit Email Template: {template.name}</DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
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
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Saving...' : 'Save Template'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

