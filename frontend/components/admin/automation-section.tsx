'use client'

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EditAutoAssignDialog } from './edit-auto-assign-dialog'
import { EditAutoResolveDialog } from './edit-auto-resolve-dialog'
import { EditAutoAcknowledgmentDialog } from './edit-auto-acknowledgment-dialog'

export function AutomationSection() {
  const [editingRule, setEditingRule] = useState<string | null>(null)

  return (
    <>
      <Card className="border border-gray-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-h3">Automation Rules</CardTitle>
          <CardDescription>Configure automated ticket management</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Auto-assign tickets */}
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">🤖</span>
                <h4 className="font-semibold">Auto-assign tickets</h4>
              </div>
              <p className="text-sm text-gray-600">Automatically assign new tickets to available agents</p>
              <p className="text-xs text-gray-500 mt-1">Method: Round-robin</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-600">On</span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setEditingRule('auto-assign')}
              >
                Edit
              </Button>
            </div>
          </div>

          {/* Auto-resolve inactive tickets */}
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">⏰</span>
                <h4 className="font-semibold">Auto-resolve inactive tickets</h4>
              </div>
              <p className="text-sm text-gray-600">Resolve tickets with no response for 7 days</p>
              <p className="text-xs text-gray-500 mt-1">Send warning: 5 days before</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-600">On</span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setEditingRule('auto-resolve')}
              >
                Edit
              </Button>
            </div>
          </div>

          {/* Auto-send acknowledgment */}
          <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">📧</span>
                <h4 className="font-semibold">Auto-send acknowledgment</h4>
              </div>
              <p className="text-sm text-gray-600">Send confirmation email when ticket is created</p>
              <p className="text-xs text-gray-500 mt-1">Template: New Ticket Created</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm text-green-600">On</span>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setEditingRule('auto-acknowledgment')}
              >
                Edit
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Dialogs */}
      <EditAutoAssignDialog
        open={editingRule === 'auto-assign'}
        onOpenChange={(open) => {
          if (!open) setEditingRule(null)
        }}
      />

      <EditAutoResolveDialog
        open={editingRule === 'auto-resolve'}
        onOpenChange={(open) => {
          if (!open) setEditingRule(null)
        }}
      />

      <EditAutoAcknowledgmentDialog
        open={editingRule === 'auto-acknowledgment'}
        onOpenChange={(open) => {
          if (!open) setEditingRule(null)
        }}
      />
    </>
  )
}

