'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useToast } from '@/components/ui/use-toast'
import { useStore } from '@/lib/store-context'

export default function NewTicketPage() {
  const router = useRouter()
  const { selectedStoreId } = useStore()
  const { toast } = useToast()
  const [isLoading, setIsLoading] = useState(false)
  const [categories, setCategories] = useState<Array<{ id: string; name: string; subjects: string[] | null }>>([])
  const [formData, setFormData] = useState({
    subject: '',
    description: '',
    categoryId: '',
    priority: 'NORMAL',
  })

  // Get available subjects based on selected category
  const getAvailableSubjects = () => {
    if (!formData.categoryId) {
      return []
    }
    const selectedCategory = categories.find(cat => cat.id === formData.categoryId)
    if (!selectedCategory) {
      return []
    }
    // Use subjects from database if available, otherwise return empty array
    // Handle JSON field which might be stored as object or array
    if (selectedCategory.subjects) {
      if (Array.isArray(selectedCategory.subjects)) {
        return selectedCategory.subjects.filter((s: any) => s && typeof s === 'string' && s.trim() !== '')
      }
      // If it's an object, try to convert it
      if (typeof selectedCategory.subjects === 'object') {
        const subjectsArray = Object.values(selectedCategory.subjects).filter((s: any) => s && typeof s === 'string' && s.trim() !== '')
        return subjectsArray.length > 0 ? subjectsArray : []
      }
    }
    return []
  }

  useEffect(() => {
    const url = selectedStoreId
      ? `/api/categories?storeId=${selectedStoreId}`
      : '/api/categories'
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const categoryArray = data.categories || []
        setCategories(categoryArray.map((cat: any) => ({
          id: cat.id,
          name: cat.name,
          subjects: cat.subjects || null, // Ensure subjects are included
        })))
      })
      .catch(console.error)
  }, [selectedStoreId])

  // Reset subject when category changes
  useEffect(() => {
    setFormData(prev => ({ ...prev, subject: '' }))
  }, [formData.categoryId])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    // Validate required fields
    if (!formData.categoryId) {
      toast({
        title: 'Validation Error',
        description: 'Please select a category',
        variant: 'destructive',
      })
      return
    }
    
    if (!formData.subject) {
      toast({
        title: 'Validation Error',
        description: 'Please select a subject',
        variant: 'destructive',
      })
      return
    }
    
    setIsLoading(true)

    try {
      const response = await fetch('/api/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create ticket')
      }

      toast({
        title: 'Success',
        description: 'Ticket created successfully!',
      })

      router.push(`/customer/tickets/${data.ticket.id}`)
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create ticket',
        variant: 'destructive',
      })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8">
        <h1 className="text-h1 mb-2">Submit a Support Ticket</h1>
        <p className="text-gray-600">We&apos;re here to help! 👋</p>
      </div>
      <Card className="border border-gray-200 shadow-sm">
        <CardHeader className="border-b border-gray-200">
          <CardTitle className="text-h3">Create New Ticket</CardTitle>
          <CardDescription>
            Submit a support request and we&apos;ll get back to you soon
          </CardDescription>
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="category">Category <span className="text-red-500">*</span></Label>
              <Select
                value={formData.categoryId}
                onValueChange={(value) => setFormData({ ...formData, categoryId: value })}
                disabled={isLoading}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      {cat.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="subject">Subject <span className="text-red-500">*</span></Label>
              {formData.categoryId && getAvailableSubjects().length > 0 ? (
                <Select
                  value={formData.subject}
                  onValueChange={(value) => setFormData({ ...formData, subject: value })}
                  disabled={isLoading || !formData.categoryId}
                >
                  <SelectTrigger className={!formData.categoryId ? "bg-gray-50 cursor-not-allowed" : ""}>
                    <SelectValue placeholder="Select issue type" />
                  </SelectTrigger>
                  <SelectContent>
                    {getAvailableSubjects().map((subject, index) => (
                      <SelectItem key={`${subject}-${index}`} value={String(subject)}>
                        {String(subject)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id="subject"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="Select category first"
                  required
                  disabled={isLoading || !formData.categoryId}
                  className="bg-gray-50 cursor-not-allowed"
                />
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Please provide detailed information about your issue..."
                rows={8}
                required
                disabled={isLoading}
              />
            </div>
          </CardContent>
          <div className="px-6 pb-6 flex gap-4">
            <Button type="submit" disabled={isLoading}>
              {isLoading ? 'Creating...' : 'Create Ticket'}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.back()}
              disabled={isLoading}
            >
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

