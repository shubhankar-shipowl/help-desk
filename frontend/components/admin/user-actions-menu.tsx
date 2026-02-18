'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreVertical, Edit, Trash2, UserX, UserCheck, Mail, Shield, Key } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import { EditUserDialog } from './edit-user-dialog'
import { ChangePasswordDialog } from './change-password-dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

interface UserActionsMenuProps {
  user: {
    id: string
    name: string | null
    email: string
    role: string
    isActive: boolean
    phone?: string | null
    storeId?: string | null
  }
  onRefresh?: () => void
}

export function UserActionsMenu({ user, onRefresh }: UserActionsMenuProps) {
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [changePasswordDialogOpen, setChangePasswordDialogOpen] = useState(false)
  const [dropdownSide, setDropdownSide] = useState<'bottom' | 'top'>('bottom')
  const triggerRef = useRef<HTMLButtonElement>(null)

  const handleEdit = () => {
    setEditDialogOpen(true)
  }

  const handleToggleStatus = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isActive: !user.isActive,
        }),
      })

      const data = await response.json()

      if (response.ok) {
        toast({
          title: 'Success',
          description: `User ${!user.isActive ? 'activated' : 'deactivated'} successfully`,
        })
        onRefresh?.()
      } else {
        toast({
          title: 'Error',
          description: data.error || 'Failed to update user status',
          variant: 'destructive',
        })
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update user status',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setLoading(true)
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'DELETE',
      })

      const data = await response.json()

      if (response.ok) {
        toast({
          title: 'Success',
          description: 'User deleted successfully',
        })
        setDeleteDialogOpen(false)
        onRefresh?.()
      } else {
        toast({
          title: 'Error',
          description: data.error || 'Failed to delete user',
          variant: 'destructive',
        })
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete user',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  // Check if dropdown should open upward
  useEffect(() => {
    const checkPosition = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        const viewportHeight = window.innerHeight
        const spaceBelow = viewportHeight - rect.bottom
        const spaceAbove = rect.top
        
        // If there's less space below than above, or less than 200px below, open upward
        if (spaceBelow < 200 || (spaceBelow < spaceAbove && spaceBelow < 300)) {
          setDropdownSide('top')
        } else {
          setDropdownSide('bottom')
        }
      }
    }
    
    // Check on mount and when window resizes
    checkPosition()
    window.addEventListener('resize', checkPosition)
    window.addEventListener('scroll', checkPosition, true)
    
    return () => {
      window.removeEventListener('resize', checkPosition)
      window.removeEventListener('scroll', checkPosition, true)
    }
  }, [])

  const handleSendEmail = async () => {
    try {
      // Copy email to clipboard
      await navigator.clipboard.writeText(user.email)
      toast({
        title: 'Email copied',
        description: `${user.email} has been copied to clipboard`,
      })
    } catch (error) {
      // Fallback: try mailto link
      try {
        window.location.href = `mailto:${user.email}`
      } catch (e) {
        toast({
          title: 'Error',
          description: 'Failed to copy email address',
          variant: 'destructive',
        })
      }
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} variant="ghost" size="sm" disabled={loading}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent 
          align="end" 
          side={dropdownSide} 
          sideOffset={5} 
          alignOffset={-5}
          collisionPadding={10}
        >
          <DropdownMenuItem onClick={handleEdit}>
            <Edit className="h-4 w-4 mr-2" />
            Edit User
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleSendEmail}>
            <Mail className="h-4 w-4 mr-2" />
            Send Email
          </DropdownMenuItem>
          {user.role === 'AGENT' && (
            <DropdownMenuItem onClick={() => setChangePasswordDialogOpen(true)}>
              <Key className="h-4 w-4 mr-2" />
              Change Password
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleToggleStatus} disabled={loading}>
            {user.isActive ? (
              <>
                <UserX className="h-4 w-4 mr-2" />
                Deactivate
              </>
            ) : (
              <>
                <UserCheck className="h-4 w-4 mr-2" />
                Activate
              </>
            )}
          </DropdownMenuItem>
          {user.role !== 'ADMIN' && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete User
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <EditUserDialog
        user={user}
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        onSuccess={() => onRefresh?.()}
      />

      <ChangePasswordDialog
        user={user}
        open={changePasswordDialogOpen}
        onOpenChange={setChangePasswordDialogOpen}
        onSuccess={() => onRefresh?.()}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{user.name || user.email}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {loading ? 'Deleting...' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

