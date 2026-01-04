'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EditEmailTemplateDialog } from './edit-email-template-dialog'
import { NewEmailTemplateDialog } from './new-email-template-dialog'

// Map template types to user-friendly names
const templateTypeMap: Record<string, { name: string; description: string }> = {
  // Notification types used in the system
  TICKET_CREATED: {
    name: 'New Ticket',
    description: 'Sent when a new ticket is created',
  },
  TICKET_ASSIGNED: {
    name: 'Ticket Assigned',
    description: 'Sent when ticket is assigned to agent',
  },
  TICKET_REPLY: {
    name: 'Ticket Reply',
    description: 'Sent when agent replies to ticket',
  },
  TICKET_UPDATED: {
    name: 'Ticket Updated',
    description: 'Sent when ticket is updated',
  },
  TICKET_STATUS_CHANGED: {
    name: 'Ticket Status Changed',
    description: 'Sent when ticket status changes',
  },
  // Legacy EMAIL_ prefixed types (for backward compatibility)
  EMAIL_TICKET_CREATED: {
    name: 'New Ticket',
    description: 'Sent when a new ticket is created',
  },
  EMAIL_TICKET_ASSIGNED: {
    name: 'Ticket Assigned',
    description: 'Sent when ticket is assigned to agent',
  },
  EMAIL_TICKET_REPLY: {
    name: 'Ticket Reply',
    description: 'Sent when agent replies to ticket',
  },
  EMAIL_TICKET_RESOLVED: {
    name: 'Ticket Resolved',
    description: 'Sent when ticket is resolved',
  },
  EMAIL_TICKET_STATUS_CHANGED: {
    name: 'Ticket Status Changed',
    description: 'Sent when ticket status changes',
  },
  EMAIL_CUSTOM: {
    name: 'Custom Template',
    description: 'Custom email template',
  },
}

interface Template {
  type: string
  name: string
  description: string
}

export function EmailTemplatesSection() {
  const router = useRouter()
  const [editingTemplate, setEditingTemplate] = useState<string | null>(null)
  const [showNewTemplateDialog, setShowNewTemplateDialog] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchTemplates()
  }, [])

  const fetchTemplates = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/notification-templates?channel=EMAIL')
      const data = await response.json()
      
      if (data.templates && Array.isArray(data.templates)) {
        // Map database templates to UI format
        const mappedTemplates = data.templates
          .filter((t: any) => t.isActive !== false) // Only show active templates
          .map((t: any) => ({
            type: t.type,
            name: templateTypeMap[t.type]?.name || t.type,
            description: templateTypeMap[t.type]?.description || 'Email template',
          }))
        
        setTemplates(mappedTemplates)
      }
    } catch (error) {
      console.error('Error fetching templates:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (type: string) => {
    setEditingTemplate(type)
  }

  const handleTemplateSaved = () => {
    fetchTemplates() // Refresh templates after save
    router.refresh()
  }

  const currentTemplate = editingTemplate
    ? templates.find((t) => t.type === editingTemplate) || {
        type: editingTemplate,
        name: templateTypeMap[editingTemplate]?.name || editingTemplate,
        description: templateTypeMap[editingTemplate]?.description || 'Email template',
      }
    : null

  return (
    <>
      <Card className="border border-gray-200 shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-h3">Email Templates</CardTitle>
            <CardDescription>Manage automated email templates</CardDescription>
          </div>
          <Button 
            className="bg-primary hover:bg-primary-dark text-white"
            onClick={() => setShowNewTemplateDialog(true)}
          >
            + New Template
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-8 text-gray-500">Loading templates...</div>
          ) : templates.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              <p>No email templates found.</p>
              <p className="text-sm mt-2">Click &quot;+ New Template&quot; to create one.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {templates.map((template) => (
                <div key={template.type} className="border border-gray-200 rounded-lg p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold">{template.name}</h4>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(template.type)}
                    >
                      Edit
                    </Button>
                  </div>
                  <p className="text-sm text-gray-600">{template.description}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {currentTemplate && (
        <EditEmailTemplateDialog
          template={currentTemplate}
          open={editingTemplate !== null}
          onOpenChange={(open) => {
            if (!open) {
              setEditingTemplate(null)
              handleTemplateSaved() // Refresh templates when dialog closes
            }
          }}
        />
      )}

      <NewEmailTemplateDialog
        open={showNewTemplateDialog}
        onOpenChange={(open) => {
          setShowNewTemplateDialog(open)
          if (!open) {
            handleTemplateSaved() // Refresh templates when dialog closes
          }
        }}
      />
    </>
  )
}

