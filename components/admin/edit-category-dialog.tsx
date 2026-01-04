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
import { useToast } from '@/components/ui/use-toast'
import { Plus, X } from 'lucide-react'

interface EditCategoryDialogProps {
  category: {
    id: string
    name: string
    icon: string | null
    subjects: string[] | null
  }
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}

export function EditCategoryDialog({ category, open, onOpenChange, onSuccess }: EditCategoryDialogProps) {
  const router = useRouter()
  const { toast } = useToast()
  const [loading, setLoading] = useState(false)
  const [subjects, setSubjects] = useState<string[]>([''])
  const [formData, setFormData] = useState({
    name: '',
    icon: '📁',
  })

  // Initialize form data when category changes
  useEffect(() => {
    if (category && open) {
      setFormData({
        name: category.name || '',
        icon: category.icon || '📁',
      })
      // Initialize subjects from category
      if (category.subjects && Array.isArray(category.subjects) && category.subjects.length > 0) {
        setSubjects(category.subjects)
      } else {
        setSubjects([''])
      }
    }
  }, [category, open])

  const addSubject = () => {
    setSubjects([...subjects, ''])
  }

  const removeSubject = (index: number) => {
    setSubjects(subjects.filter((_, i) => i !== index))
  }

  const updateSubject = (index: number, value: string) => {
    const newSubjects = [...subjects]
    newSubjects[index] = value
    setSubjects(newSubjects)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Filter out empty subjects
    const validSubjects = subjects.filter(s => s.trim() !== '')
    
    if (!formData.name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Category name is required',
        variant: 'destructive',
      })
      return
    }

    setLoading(true)

    try {
      const response = await fetch(`/api/categories/${category.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          icon: formData.icon,
          subjects: validSubjects.length > 0 ? validSubjects : null,
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update category')
      }

      toast({
        title: 'Success',
        description: 'Category updated successfully',
      })

      onOpenChange(false)
      if (onSuccess) {
        onSuccess()
      }
      // Refresh the page data without losing the tab state
      router.refresh()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  const commonIcons = ['📁', '💻', '📱', '🔧', '💰', '🚀', '📊', '🎨', '🛒', '📞', '✉️', '🔒', '🌐', '⚙️', '📝']

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Edit Category</DialogTitle>
          <DialogDescription>
            Update category details and subjects
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-category-name">Name *</Label>
              <Input
                id="edit-category-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                required
                placeholder="Technical Support"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-category-icon">Icon</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="edit-category-icon"
                  value={formData.icon}
                  onChange={(e) => setFormData({ ...formData, icon: e.target.value })}
                  placeholder="📁"
                  maxLength={2}
                  className="w-20"
                />
                <div className="flex gap-1 flex-wrap">
                  {commonIcons.map((icon) => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setFormData({ ...formData, icon })}
                      className={`p-2 rounded hover:bg-gray-100 text-xl ${
                        formData.icon === icon ? 'bg-blue-100 ring-2 ring-blue-500' : ''
                      }`}
                    >
                      {icon}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="edit-category-subjects">Subjects (Optional)</Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addSubject}
                  className="h-8"
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add Subject
                </Button>
              </div>
              <div className="space-y-2">
                {subjects.map((subject, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={subject}
                      onChange={(e) => updateSubject(index, e.target.value)}
                      placeholder={`Subject ${index + 1}`}
                      className="flex-1"
                    />
                    {subjects.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSubject(index)}
                        className="h-10 w-10 p-0"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-gray-500">
                Add subjects that will appear in the ticket creation form when this category is selected
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Updating...' : 'Update Category'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

