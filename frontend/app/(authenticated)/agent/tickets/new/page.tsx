'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import { useStore } from '@/lib/store-context'
import Link from 'next/link'
import { 
  Ticket, Mail, Phone, User, FileText, Upload, X, CheckCircle, 
  AlertCircle, HelpCircle, Sparkles, MessageSquare, Shield, Zap, ArrowLeft
} from 'lucide-react'
import { cn } from '@/lib/utils'

export default function AgentNewTicketPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { selectedStoreId } = useStore()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [ticketData, setTicketData] = useState<{ id: string; ticketNumber: string } | null>(null)
  const [categories, setCategories] = useState<Array<{ id: string; name: string; subjects: string[] | null }>>([])
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    order: '',
    trackingId: '',
    subject: '',
    description: '',
    categoryId: '',
    priority: 'NORMAL',
  })
  const [attachments, setAttachments] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

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

  // Reset subject when category changes
  useEffect(() => {
    setFormData(prev => ({ ...prev, subject: '' }))
  }, [formData.categoryId])
  const [touched, setTouched] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const url = selectedStoreId
      ? `/api/categories?storeId=${selectedStoreId}`
      : '/api/categories'
    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        const categoryArray = data.categories || []
        const seenIds = new Set<string>()
        const seenNames = new Set<string>()
        const uniqueCategories = categoryArray.map((cat: any) => ({
          id: cat.id,
          name: cat.name,
          subjects: cat.subjects || null, // Ensure subjects are included
        })).filter((cat: { id: string; name: string }) => {
          if (seenIds.has(cat.id) || seenNames.has(cat.name)) {
            return false
          }
          seenIds.add(cat.id)
          seenNames.add(cat.name)
          return true
        })
        setCategories(uniqueCategories)
      })
      .catch((error: any) => {
        console.error('Error fetching categories:', error)
        setCategories([])
      })
  }, [selectedStoreId])

  const priorities = [
    { value: 'LOW', label: 'Low', color: 'bg-gray-100 text-gray-700 border-gray-300', description: 'General inquiry' },
    { value: 'NORMAL', label: 'Normal', color: 'bg-blue-100 text-blue-700 border-blue-300', description: 'Standard request' },
    { value: 'HIGH', label: 'High', color: 'bg-orange-100 text-orange-700 border-orange-300', description: 'Needs attention' },
    { value: 'URGENT', label: 'Urgent', color: 'bg-red-100 text-red-700 border-red-300', description: 'Critical issue' },
  ]

  const validateField = (name: string, value: string) => {
    const validations: Record<string, () => string | null> = {
      name: () => !value.trim() ? 'Please enter customer name' : value.length < 2 ? 'Name must be at least 2 characters' : null,
      categoryId: () => !value.trim() ? 'Please select a category' : null,
      subject: () => !value.trim() ? 'Please select a subject' : null,
      email: () => {
        if (!value.trim()) return 'Please enter customer email'
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        return !emailRegex.test(value) ? 'Please enter a valid email address' : null
      },
      phone: () => !value.trim() ? 'Please enter customer phone number' : null,
      order: () => !value.trim() ? 'Please enter order ID' : null,
      trackingId: () => !value.trim() ? 'Please enter tracking ID' : null,
      description: () => !value.trim() ? 'Please describe the issue' : value.length < 20 ? 'Please provide more details (at least 20 characters)' : null,
    }
    return validations[name]?.() || null
  }

  const handleChange = (name: string, value: string) => {
    setFormData(prev => ({ ...prev, [name]: value }))
    
    if (touched[name]) {
      const error = validateField(name, value)
      setErrors(prev => ({
        ...prev,
        [name]: error || '',
      }))
    }
  }

  const handleBlur = (name: string) => {
    setTouched(prev => ({ ...prev, [name]: true }))
    const error = validateField(name, formData[name as keyof typeof formData] as string)
    if (error) {
      setErrors(prev => ({ ...prev, [name]: error }))
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const validFiles = files.filter(file => {
      const maxSize = 10 * 1024 * 1024 // 10MB
      if (file.size > maxSize) {
        toast({
          title: 'File too large',
          description: `${file.name} is larger than 10MB`,
          variant: 'destructive',
        })
        return false
      }
      return true
    })
    setAttachments(prev => [...prev, ...validFiles])
  }

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index))
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const requiredFields = ['name', 'email', 'phone', 'order', 'trackingId', 'categoryId', 'subject', 'description']
    const newErrors: Record<string, string> = {}
    
    requiredFields.forEach(field => {
      const error = validateField(field, formData[field as keyof typeof formData] as string)
      if (error) {
        newErrors[field] = error
      }
    })

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      setTouched(
        requiredFields.reduce((acc, field) => ({ ...acc, [field]: true }), {})
      )
      return
    }

    setIsSubmitting(true)

    try {
      let response: Response
      
      if (attachments.length > 0) {
        const formDataToSend = new FormData()
        formDataToSend.append('name', formData.name)
        formDataToSend.append('email', formData.email)
        formDataToSend.append('phone', formData.phone)
        formDataToSend.append('order', formData.order)
        formDataToSend.append('trackingId', formData.trackingId)
        formDataToSend.append('subject', formData.subject)
        formDataToSend.append('description', formData.description)
        formDataToSend.append('categoryId', formData.categoryId || '')
        formDataToSend.append('priority', formData.priority)
        
        attachments.forEach((file) => {
          formDataToSend.append('attachments', file)
        })

        response = await fetch('/api/tickets/agent', {
          method: 'POST',
          body: formDataToSend,
        })
      } else {
        response = await fetch('/api/tickets/agent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formData,
            phone: formData.phone,
            trackingId: formData.trackingId,
          }),
        })
      }

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create ticket')
      }

      setTicketData({
        id: data.ticket.id,
        ticketNumber: data.ticket.ticketNumber,
      })
      setShowSuccess(true)
      
      toast({
        title: 'Success',
        description: 'Ticket created successfully!',
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create ticket',
        variant: 'destructive',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // Calculate progress
  const filledFields = Object.entries(formData).filter(([key, value]) => {
    if (key === 'categoryId' || key === 'priority') return false // Don't count these
    return value && value.trim().length > 0
  }).length + (attachments.length > 0 ? 1 : 0)
  const totalFields = 8 // name, email, phone, order, trackingId, subject, description, attachments
  const progress = Math.min(100, Math.round((filledFields / totalFields) * 100))

  if (showSuccess && ticketData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 flex items-center justify-center p-4">
        <div className="max-w-2xl w-full">
          <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
            <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-12 h-12 text-green-600" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Ticket Created Successfully!</h1>
            <p className="text-gray-600 mb-6">
              Your ticket has been created and will be assigned to an agent shortly.
            </p>
            <div className="bg-gray-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-gray-500 mb-2">Ticket Number</p>
              <p className="text-2xl font-bold text-gray-900">{ticketData.ticketNumber}</p>
            </div>
            <div className="flex gap-4 justify-center">
              <Button
                onClick={() => router.push(`/agent/tickets/${ticketData.id}`)}
                className="bg-primary hover:bg-primary-dark"
              >
                View Ticket
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowSuccess(false)
                  setTicketData(null)
                  setFormData({
                    name: '',
                    email: '',
                    phone: '',
                    order: '',
                    trackingId: '',
                    subject: '',
                    description: '',
                    categoryId: '',
                    priority: 'NORMAL',
                  })
                  setAttachments([])
                  setErrors({})
                  setTouched({})
                }}
              >
                Create Another
              </Button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/agent/tickets"
            className="inline-flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Tickets
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Create New Ticket</h1>
          <p className="text-gray-600">Create a ticket on behalf of a customer</p>
        </div>

        {/* Progress Bar */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Form Progress</span>
            <span className="text-sm font-semibold text-primary">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-gradient-to-r from-purple-600 to-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Customer Information Section */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <User className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Customer Information</h2>
                <p className="text-sm text-gray-500">Enter customer details</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Name */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Customer Name <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => handleChange('name', e.target.value)}
                    onBlur={() => handleBlur('name')}
                    className={cn(
                      "w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all",
                      errors.name ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-primary"
                    )}
                    placeholder="John Doe"
                  />
                </div>
                {errors.name && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.name}
                  </p>
                )}
              </div>

              {/* Email */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => handleChange('email', e.target.value)}
                    onBlur={() => handleBlur('email')}
                    className={cn(
                      "w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all",
                      errors.email ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-primary"
                    )}
                    placeholder="customer@example.com"
                  />
                </div>
                {errors.email && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.email}
                  </p>
                )}
              </div>

              {/* Phone */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    onBlur={() => handleBlur('phone')}
                    className={cn(
                      "w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all",
                      errors.phone ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-primary"
                    )}
                    placeholder="+1 234 567 8900"
                  />
                </div>
                {errors.phone && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.phone}
                  </p>
                )}
              </div>

              {/* Order ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Order ID <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={formData.order}
                    onChange={(e) => handleChange('order', e.target.value)}
                    onBlur={() => handleBlur('order')}
                    className={cn(
                      "w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all",
                      errors.order ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-primary"
                    )}
                    placeholder="ORD-12345"
                  />
                </div>
                {errors.order && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.order}
                  </p>
                )}
              </div>

              {/* Tracking ID */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Tracking ID <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={formData.trackingId}
                    onChange={(e) => handleChange('trackingId', e.target.value)}
                    onBlur={() => handleBlur('trackingId')}
                    className={cn(
                      "w-full pl-10 pr-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all",
                      errors.trackingId ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-primary"
                    )}
                    placeholder="TRK-12345"
                  />
                </div>
                {errors.trackingId && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.trackingId}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Ticket Details Section */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <Ticket className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Ticket Details</h2>
                <p className="text-sm text-gray-500">Describe the issue or request</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Category */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.categoryId}
                  onChange={(e) => handleChange('categoryId', e.target.value)}
                  onBlur={() => handleBlur('categoryId')}
                  className={cn(
                    "w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all",
                    errors.categoryId ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-primary"
                  )}
                >
                  <option value="">Select category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
                {errors.categoryId && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.categoryId}
                  </p>
                )}
              </div>

              {/* Subject */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Subject <span className="text-red-500">*</span>
                </label>
                {formData.categoryId && getAvailableSubjects().length > 0 ? (
                  <select
                    value={formData.subject}
                    onChange={(e) => handleChange('subject', e.target.value)}
                    onBlur={() => handleBlur('subject')}
                    disabled={!formData.categoryId}
                    className={cn(
                      "w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all",
                      !formData.categoryId ? "bg-gray-50 cursor-not-allowed" : "",
                      errors.subject ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-primary"
                    )}
                  >
                    <option value="">Select issue type</option>
                    {getAvailableSubjects().map((subject, index) => (
                      <option key={`${subject}-${index}`} value={String(subject)}>
                        {String(subject)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={formData.subject}
                    onChange={(e) => handleChange('subject', e.target.value)}
                    onBlur={() => handleBlur('subject')}
                    className={cn(
                      "w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all",
                      "bg-gray-50 cursor-not-allowed",
                      errors.subject ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-primary"
                    )}
                    placeholder="Select category first"
                    disabled={!formData.categoryId}
                  />
                )}
                {errors.subject && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.subject}
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Description <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  onBlur={() => handleBlur('description')}
                  rows={6}
                  className={cn(
                    "w-full px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 transition-all resize-none",
                    errors.description ? "border-red-300 focus:ring-red-500" : "border-gray-300 focus:ring-primary"
                  )}
                  placeholder="Provide detailed information about the issue..."
                />
                {errors.description && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-4 h-4" />
                    {errors.description}
                  </p>
                )}
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Priority
                </label>
                <select
                  value={formData.priority}
                  onChange={(e) => handleChange('priority', e.target.value)}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  {priorities.map((priority) => (
                    <option key={priority.value} value={priority.value}>
                      {priority.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Attachments Section */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                <Upload className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <h2 className="text-xl font-semibold text-gray-900">Attachments</h2>
                <p className="text-sm text-gray-500">Add files related to this ticket (optional)</p>
              </div>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />

            <Button
              type="button"
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              className="w-full mb-4"
            >
              <Upload className="w-4 h-4 mr-2" />
              Choose Files
            </Button>

            {attachments.length > 0 && (
              <div className="space-y-2">
                {attachments.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="w-5 h-5 text-gray-400" />
                      <div>
                        <p className="text-sm font-medium text-gray-900">{file.name}</p>
                        <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeAttachment(index)}
                      className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Submit Button */}
          <div className="flex gap-4">
            <Button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 bg-primary hover:bg-primary-dark text-white py-6 text-lg font-semibold"
            >
              {isSubmitting ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  Creating Ticket...
                </>
              ) : (
                <>
                  <Ticket className="w-5 h-5 mr-2" />
                  Create Ticket
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push('/agent/tickets')}
              className="px-6"
            >
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

