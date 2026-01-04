'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/use-toast'
import Link from 'next/link'
import { 
  Ticket, Mail, Phone, User, FileText, Upload, X, CheckCircle, 
  AlertCircle, HelpCircle, Sparkles, MessageSquare, Shield, Zap, Wand2
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatAndFilterText, formatAsProfessionalEmail } from '@/lib/text-formatter'

export default function PublicNewTicketPage() {
  const router = useRouter()
  const { toast } = useToast()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [ticketData, setTicketData] = useState<{ id: string; ticketNumber: string; token: string } | null>(null)
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

  // Check if selected category requires attachments
  const requiresAttachments = () => {
    if (!formData.categoryId) return false
    const selectedCategory = categories.find(cat => cat.id === formData.categoryId)
    if (!selectedCategory) return false
    
    const categoryName = selectedCategory.name.toLowerCase()
    // Remove emojis and special characters, normalize spaces
    const cleanName = categoryName.replace(/[📦🔄&/]/g, ' ').replace(/\s+/g, ' ').trim()
    
    // Check for "Order & Product Issues" or similar
    const isOrderProduct = cleanName.includes('order') && cleanName.includes('product')
    
    // Check for "Return / Refund / Replacement" or similar
    const isReturnRefund = cleanName.includes('return') && (cleanName.includes('refund') || cleanName.includes('replacement'))
    
    return isOrderProduct || isReturnRefund
  }
  const [attachments, setAttachments] = useState<File[]>([])
  const [singleFile, setSingleFile] = useState<File | null>(null)
  const [imageFiles, setImageFiles] = useState<[File | null, File | null, File | null]>([null, null, null])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const singleFileInputRef = useRef<HTMLInputElement>(null)
  const imageFileInputRefs = [useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null), useRef<HTMLInputElement>(null)]
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const lookupTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    fetch('/api/categories')
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
      .catch((error) => {
        console.error('Error fetching categories:', error)
        setCategories([])
      })
  }, [])


  const validateField = (name: string, value: string) => {
    const validations: Record<string, () => string | null> = {
      name: () => !value.trim() ? 'Please enter your name' : value.length < 2 ? 'Name must be at least 2 characters' : null,
      email: () => {
        if (!value.trim()) return 'Please enter your email'
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        return !emailRegex.test(value) ? 'Please enter a valid email address' : null
      },
      phone: () => !value.trim() ? 'Please enter your phone number' : null,
      order: () => !value.trim() ? 'Please enter your order ID' : null,
      trackingId: () => !value.trim() ? 'Please enter your tracking ID' : null,
      subject: () => !value.trim() ? 'Please enter a subject' : value.length < 5 ? 'Subject must be at least 5 characters' : null,
      description: () => !value.trim() ? 'Please describe your issue' : value.length < 20 ? 'Please provide more details (at least 20 characters)' : null,
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

    // Auto-fill Order ID and Tracking ID when phone number is entered (with debounce)
    if (name === 'phone' && value.trim().length >= 10) {
      // Clear existing timeout
      if (lookupTimeoutRef.current) {
        clearTimeout(lookupTimeoutRef.current)
      }
      
      // Set new timeout for debounced lookup
      lookupTimeoutRef.current = setTimeout(() => {
        lookupOrderTracking(value.trim())
      }, 500) // Wait 500ms after user stops typing
    }
  }

  // Lookup Order ID and Tracking ID by phone number
  const lookupOrderTracking = async (phone: string) => {
    try {
      // Normalize phone number
      const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '')
      
      if (normalizedPhone.length < 10) {
        return
      }

      const response = await fetch(`/api/order-tracking/lookup?phone=${encodeURIComponent(normalizedPhone)}`)
      const data = await response.json()

      if (data.found && data.orderId && data.trackingId) {
        // Auto-fill Order ID and Tracking ID
        setFormData(prev => ({
          ...prev,
          order: data.orderId,
          trackingId: data.trackingId,
        }))
        
        // Clear any existing errors for these fields
        setErrors(prev => ({
          ...prev,
          order: '',
          trackingId: '',
        }))

        toast({
          title: 'Order information found',
          description: 'Order ID and Tracking ID have been auto-filled',
        })
      }
    } catch (error) {
      // Silently fail - don't show error if lookup fails
      console.error('Error looking up order tracking:', error)
    }
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (lookupTimeoutRef.current) {
        clearTimeout(lookupTimeoutRef.current)
      }
    }
  }, [])

  const handleBlur = (name: string) => {
    setTouched(prev => ({ ...prev, [name]: true }))
    const error = validateField(name, formData[name as keyof typeof formData] as string)
    if (error) {
      setErrors(prev => ({ ...prev, [name]: error }))
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      const maxSize = 10 * 1024 * 1024 // 10MB
      const validFiles = files.filter(file => {
        if (file.size > maxSize) {
          toast({
            title: 'File too large',
            description: `${file.name} exceeds 10MB limit`,
            variant: 'destructive',
          })
          return false
        }
        return true
      })
      
      const newFiles = [...attachments, ...validFiles].slice(0, 5)
      setAttachments(newFiles)
      
      if (validFiles.length > 0) {
        toast({
          title: 'Files selected',
          description: `${validFiles.length} file(s) added`,
        })
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const handleSingleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Check if it's a video
      if (!file.type.startsWith('video/')) {
        toast({
          title: 'Invalid file type',
          description: 'Only video files are allowed in this section',
          variant: 'destructive',
        })
        if (singleFileInputRef.current) {
          singleFileInputRef.current.value = ''
        }
        return
      }
      const maxSize = 10 * 1024 * 1024 // 10MB
      if (file.size > maxSize) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds 10MB limit`,
          variant: 'destructive',
        })
        if (singleFileInputRef.current) {
          singleFileInputRef.current.value = ''
        }
        return
      }
      setSingleFile(file)
      // Clear attachment error if file is uploaded
      if (errors.attachments) {
        setErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.attachments
          return newErrors
        })
      }
      toast({
        title: 'Video selected',
        description: `${file.name} added`,
      })
    }
    if (singleFileInputRef.current) {
      singleFileInputRef.current.value = ''
    }
  }

  const handleImageFileSelect = (index: number) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      // Check if it's an image
      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Invalid file type',
          description: 'Only images are allowed in this section',
          variant: 'destructive',
        })
        if (imageFileInputRefs[index].current) {
          imageFileInputRefs[index].current.value = ''
        }
        return
      }
      const maxSize = 10 * 1024 * 1024 // 10MB
      if (file.size > maxSize) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds 10MB limit`,
          variant: 'destructive',
        })
        if (imageFileInputRefs[index].current) {
          imageFileInputRefs[index].current.value = ''
        }
        return
      }
      const newImageFiles: [File | null, File | null, File | null] = [...imageFiles]
      newImageFiles[index] = file
      setImageFiles(newImageFiles)
      // Clear attachment error if file is uploaded
      if (errors.attachments) {
        setErrors(prev => {
          const newErrors = { ...prev }
          delete newErrors.attachments
          return newErrors
        })
      }
      toast({
        title: 'Image selected',
        description: `${file.name} added`,
      })
    }
    if (imageFileInputRefs[index].current) {
      imageFileInputRefs[index].current.value = ''
    }
  }

  const handleRemoveAttachment = (index: number) => {
    setAttachments(attachments.filter((_, i) => i !== index))
  }

  const handleRemoveSingleFile = () => {
    setSingleFile(null)
  }

  const handleRemoveImageFile = (index: number) => {
    const newImageFiles: [File | null, File | null, File | null] = [...imageFiles]
    newImageFiles[index] = null
    setImageFiles(newImageFiles)
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    const requiredFields = ['name', 'email', 'phone', 'order', 'trackingId', 'subject', 'description']
    const newErrors: Record<string, string> = {}
    
    requiredFields.forEach(field => {
      const error = validateField(field, formData[field as keyof typeof formData] as string)
      if (error) {
        newErrors[field] = error
      }
    })

    // Check if attachments are required for selected category
    if (requiresAttachments()) {
      // Collect all files: single file + image files + old attachments
      const allFiles: File[] = []
      if (singleFile) allFiles.push(singleFile)
      imageFiles.forEach(file => {
        if (file) allFiles.push(file)
      })
      attachments.forEach(file => allFiles.push(file))

      if (allFiles.length === 0) {
        newErrors.attachments = 'Images or videos are required for this category'
        setTouched(prev => ({ ...prev, attachments: true }))
      }
    }

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
      
      // Collect all files: single file + image files + old attachments
      const allFiles: File[] = []
      if (singleFile) allFiles.push(singleFile)
      imageFiles.forEach(file => {
        if (file) allFiles.push(file)
      })
      attachments.forEach(file => allFiles.push(file))

      if (allFiles.length > 0) {
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
        
        allFiles.forEach((file) => {
          formDataToSend.append('attachments', file)
        })

        response = await fetch('/api/tickets/public', {
          method: 'POST',
          body: formDataToSend,
        })
      } else {
        response = await fetch('/api/tickets/public', {
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
        token: data.token,
      })
      setShowSuccess(true)
      
      setTimeout(() => {
        router.push(`/tickets/${data.ticket.id}?token=${data.token}`)
      }, 3000)
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create ticket',
        variant: 'destructive',
      })
      setIsSubmitting(false)
    }
  }

  // Calculate form progress
  // Count only user-filled fields (exclude categoryId and priority which have defaults)
  const fieldsToCount = ['name', 'email', 'phone', 'order', 'trackingId', 'subject', 'description']
  const totalFields = fieldsToCount.length
  const filledFields = fieldsToCount.filter(key => {
    const value = formData[key as keyof typeof formData]
    return Boolean(value && value.trim())
  }).length
  const progress = Math.round((filledFields / totalFields) * 100)

  if (showSuccess && ticketData) {
    return <SuccessScreen ticketNumber={ticketData.ticketNumber} ticketId={ticketData.id} token={ticketData.token} />
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-purple-50 py-2 sm:py-4 px-3 sm:px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-3 sm:mb-4">
          <div className="inline-flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-indigo-600 to-purple-600 rounded-lg sm:rounded-xl mb-2 shadow-lg">
            <Ticket className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 mb-1 sm:mb-2 px-2">
            Submit a Support Ticket
          </h1>
          <p className="text-sm sm:text-base text-gray-600 flex items-center justify-center gap-2 px-2">
            We&apos;re here to help! <span className="animate-wave">👋</span>
          </p>
          <p className="text-xs text-gray-500 mt-0.5 sm:mt-1 px-2">
            No account required - submit your ticket and we&apos;ll get back to you soon
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-3 sm:mb-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-medium text-gray-700">
              Form Progress
            </span>
            <span className="text-xs font-semibold text-indigo-600">
              {progress}%
            </span>
          </div>
          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-indigo-600 to-purple-600 transition-all duration-500 ease-out"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Main Form Card */}
        <div className="bg-white rounded-xl sm:rounded-2xl shadow-xl border border-gray-100 overflow-hidden">
          {/* Card Header */}
          <div className="bg-gradient-to-r from-indigo-600 to-purple-600 px-4 sm:px-6 py-2 sm:py-3">
            <h2 className="text-base sm:text-lg md:text-xl font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 sm:w-5 sm:h-5" />
              Create New Ticket
            </h2>
            <p className="text-xs text-indigo-100 mt-0.5">
              Fill in the details below and we&apos;ll assist you right away
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="p-3 sm:p-4 md:p-5 space-y-3 sm:space-y-4">
            {/* Step 1: Personal Information */}
            <div className="space-y-2.5 sm:space-y-3">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-200">
                <div className="w-6 h-6 sm:w-7 sm:h-7 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <User className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" />
                </div>
                <h3 className="text-sm sm:text-base font-semibold text-gray-900">
                  Your Information
                </h3>
              </div>

              {/* Name and Email Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 sm:gap-3">
                {/* Name Field */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Your Name <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <User className="w-4 h-4" />
                    </div>
                    <input
                      type="text"
                      name="name"
                      value={formData.name}
                      onChange={(e) => handleChange('name', e.target.value)}
                      onBlur={() => handleBlur('name')}
                      placeholder="John Doe"
                      className={cn(
                        "w-full pl-10 pr-10 py-2 text-sm rounded-lg border-2 transition-all duration-200",
                        "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-100",
                        errors.name && touched.name
                          ? "border-red-300 bg-red-50 focus:border-red-500"
                          : formData.name && !errors.name
                          ? "border-green-300 bg-green-50 focus:border-green-500"
                          : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                      )}
                    />
                    {formData.name && !errors.name && (
                      <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
                    )}
                  </div>
                  {errors.name && touched.name && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {errors.name}
                    </p>
                  )}
                </div>

                {/* Email Field */}
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">
                    Email Address <span className="text-red-500">*</span>
                  </label>
                  <div className="relative">
                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                      <Mail className="w-4 h-4" />
                    </div>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={(e) => handleChange('email', e.target.value)}
                      onBlur={() => handleBlur('email')}
                      placeholder="john@example.com"
                      className={cn(
                        "w-full pl-10 pr-10 py-2 text-sm rounded-lg border-2 transition-all duration-200",
                        "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-100",
                        errors.email && touched.email
                          ? "border-red-300 bg-red-50 focus:border-red-500"
                          : formData.email && !errors.email
                          ? "border-green-300 bg-green-50 focus:border-green-500"
                          : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                      )}
                    />
                    {formData.email && !errors.email && (
                      <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
                    )}
                  </div>
                  {errors.email && touched.email && (
                    <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      {errors.email}
                    </p>
                  )}
                </div>
              </div>

              {/* Phone Number */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Phone Number <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Phone className="w-4 h-4" />
                  </div>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={(e) => handleChange('phone', e.target.value)}
                    onBlur={() => handleBlur('phone')}
                    placeholder="+1 (555) 123-4567"
                    className={cn(
                      "w-full pl-10 pr-10 py-2 text-sm rounded-lg border-2 transition-all duration-200",
                      "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-100",
                      errors.phone && touched.phone
                        ? "border-red-300 bg-red-50 focus:border-red-500"
                        : formData.phone && !errors.phone
                        ? "border-green-300 bg-green-50 focus:border-green-500"
                        : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                    )}
                  />
                  {formData.phone && !errors.phone && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
                  )}
                </div>
                {errors.phone && touched.phone && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {errors.phone}
                  </p>
                )}
                <p className="mt-1 text-xs text-gray-500 flex items-center gap-1">
                  <HelpCircle className="w-3 h-3 flex-shrink-0" />
                  <span>We&apos;ll use this for urgent updates about your ticket</span>
                </p>
              </div>

              {/* Order ID */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Order ID <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <FileText className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    name="order"
                    value={formData.order}
                    onChange={(e) => handleChange('order', e.target.value)}
                    onBlur={() => handleBlur('order')}
                    placeholder="ORD-123456"
                    className={cn(
                      "w-full pl-10 pr-10 py-2 text-sm rounded-lg border-2 transition-all duration-200",
                      "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-100",
                      errors.order && touched.order
                        ? "border-red-300 bg-red-50 focus:border-red-500"
                        : formData.order && !errors.order
                        ? "border-green-300 bg-green-50 focus:border-green-500"
                        : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                    )}
                  />
                  {formData.order && !errors.order && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
                  )}
                </div>
                {errors.order && touched.order && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {errors.order}
                  </p>
                )}
              </div>

              {/* Tracking ID */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Tracking ID <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <FileText className="w-4 h-4" />
                  </div>
                  <input
                    type="text"
                    name="trackingId"
                    value={formData.trackingId}
                    onChange={(e) => handleChange('trackingId', e.target.value)}
                    onBlur={() => handleBlur('trackingId')}
                    placeholder="TRK-123456"
                    className={cn(
                      "w-full pl-10 pr-10 py-2 text-sm rounded-lg border-2 transition-all duration-200",
                      "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-100",
                      errors.trackingId && touched.trackingId
                        ? "border-red-300 bg-red-50 focus:border-red-500"
                        : formData.trackingId && !errors.trackingId
                        ? "border-green-300 bg-green-50 focus:border-green-500"
                        : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                    )}
                  />
                  {formData.trackingId && !errors.trackingId && (
                    <CheckCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
                  )}
                </div>
                {errors.trackingId && touched.trackingId && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {errors.trackingId}
                  </p>
                )}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200" />

            {/* Step 2: Issue Details */}
            <div className="space-y-2.5 sm:space-y-3">
              <div className="flex items-center gap-2 pb-1.5 border-b border-gray-200">
                <div className="w-6 h-6 sm:w-7 sm:h-7 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <MessageSquare className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-600" />
                </div>
                <h3 className="text-sm sm:text-base font-semibold text-gray-900">
                  Issue Details
                </h3>
              </div>

              {/* Category Selection */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Category <span className="text-red-500">*</span>
                </label>
                <select
                  value={formData.categoryId}
                  onChange={(e) => handleChange('categoryId', e.target.value)}
                  onBlur={() => handleBlur('categoryId')}
                  className={cn(
                    "w-full px-3 py-2 text-sm rounded-lg border-2 transition-all duration-200",
                    "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-100",
                    errors.categoryId && touched.categoryId
                      ? "border-red-300 bg-red-50 focus:border-red-500"
                      : formData.categoryId && !errors.categoryId
                      ? "border-green-300 bg-green-50 focus:border-green-500"
                      : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                  )}
                >
                  <option value="">Select category</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
                {errors.categoryId && touched.categoryId && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {errors.categoryId}
                  </p>
                )}
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Subject <span className="text-red-500">*</span>
                </label>
                {formData.categoryId && getAvailableSubjects().length > 0 ? (
                  <select
                    name="subject"
                    value={formData.subject}
                    onChange={(e) => handleChange('subject', e.target.value)}
                    onBlur={() => handleBlur('subject')}
                    disabled={!formData.categoryId}
                    className={cn(
                      "w-full px-3 py-2 text-sm rounded-lg border-2 transition-all duration-200",
                      "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-100",
                      !formData.categoryId ? "bg-gray-50 cursor-not-allowed" : "",
                      errors.subject && touched.subject
                        ? "border-red-300 bg-red-50 focus:border-red-500"
                        : formData.subject && !errors.subject
                        ? "border-green-300 bg-green-50 focus:border-green-500"
                        : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                    )}
                  >
                    <option value="">Select issue type</option>
                    {getAvailableSubjects().map((subject) => (
                      <option key={subject} value={subject}>
                        {subject}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    name="subject"
                    value={formData.subject}
                    onChange={(e) => handleChange('subject', e.target.value)}
                    onBlur={() => handleBlur('subject')}
                    placeholder="Select category first"
                    disabled={!formData.categoryId}
                    className={cn(
                      "w-full px-3 py-2 text-sm rounded-lg border-2 transition-all duration-200",
                      "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-100",
                      "bg-gray-50 cursor-not-allowed",
                      errors.subject && touched.subject
                        ? "border-red-300 bg-red-50 focus:border-red-500"
                        : formData.subject && !errors.subject
                        ? "border-green-300 bg-green-50 focus:border-green-500"
                        : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                    )}
                  />
                )}
                {errors.subject && touched.subject && (
                  <p className="mt-1 text-xs text-red-600 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    {errors.subject}
                  </p>
                )}
              </div>

              {/* Description */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-semibold text-gray-700">
                    Description <span className="text-red-500">*</span>
                  </label>
                  {formData.description && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        // Format as professional email
                        const formattedEmail = formatAsProfessionalEmail(
                          formData.description,
                          formData.name || undefined
                        )
                        console.log('Formatting text:', { original: formData.description, formatted: formattedEmail })
                        handleChange('description', formattedEmail)
                        toast({
                          title: 'Text Formatted',
                          description: 'Description has been formatted as a professional email.',
                        })
                      }}
                      className="h-7 px-2 text-xs gap-1.5"
                    >
                      <Wand2 className="w-3 h-3" />
                      Format & Filter
                    </Button>
                  )}
                </div>
                <textarea
                  name="description"
                  value={formData.description}
                  onChange={(e) => handleChange('description', e.target.value)}
                  onBlur={() => handleBlur('description')}
                  placeholder="Please provide detailed information about your issue..."
                  rows={3}
                  className={cn(
                    "w-full px-3 py-2 text-sm rounded-lg border-2 transition-all duration-200",
                    "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-100 resize-none",
                    errors.description && touched.description
                      ? "border-red-300 bg-red-50 focus:border-red-500"
                      : formData.description && !errors.description
                      ? "border-green-300 bg-green-50 focus:border-green-500"
                      : "border-gray-200 hover:border-gray-300 focus:border-indigo-500"
                  )}
                />
                <div className="flex items-center justify-between mt-1 flex-wrap gap-1">
                  {errors.description && touched.description ? (
                    <p className="text-xs text-red-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="break-words">{errors.description}</span>
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500">
                      {formData.description.length} characters
                    </p>
                  )}
                  <p className="text-xs text-gray-400">
                    Min 20 chars
                  </p>
                </div>
              </div>

              {/* File Upload */}
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-2">
                  Attachments{' '}
                  {requiresAttachments() ? (
                    <span className="text-red-500">*</span>
                  ) : (
                    <span className="text-gray-400">(Optional)</span>
                  )}
                </label>
                {requiresAttachments() && (
                  <p className="text-xs text-gray-600 mb-2">
                    Images or videos are required for this category
                  </p>
                )}
                {errors.attachments && touched.attachments && (
                  <p className="text-xs text-red-600 mb-2 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                    <span>{errors.attachments}</span>
                  </p>
                )}
                
                {/* First Row: Single Video Upload Card */}
                <div className="mb-2 sm:mb-3">
                  <label className="cursor-pointer block">
                    <input
                      type="file"
                      ref={singleFileInputRef}
                      accept="video/*"
                      onChange={handleSingleFileSelect}
                      className="hidden"
                      disabled={!!singleFile}
                    />
                    <div className={cn(
                      "border-2 border-dashed rounded-lg p-3 sm:p-4 text-center transition-all duration-200",
                      singleFile 
                        ? "border-green-300 bg-green-50" 
                        : requiresAttachments() && !singleFile
                        ? "border-red-300 bg-red-50 hover:border-red-400"
                        : "border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 active:bg-indigo-100"
                    )}>
                      {singleFile ? (
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="flex-shrink-0 w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
                              <FileText className="w-5 h-5 text-green-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs sm:text-sm font-medium text-gray-900 truncate">
                                {singleFile.name}
                              </p>
                              <p className="text-[10px] sm:text-xs text-gray-500">
                                {formatFileSize(singleFile.size)}
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              handleRemoveSingleFile()
                            }}
                            className="flex-shrink-0 p-1.5 hover:bg-red-100 active:bg-red-200 rounded-lg transition-colors"
                            aria-label="Remove video"
                          >
                            <X className="w-4 h-4 text-red-600" />
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="inline-flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 bg-indigo-100 rounded-full mb-2">
                            <Upload className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" />
                          </div>
                          <p className="text-xs font-medium text-gray-900 mb-1">
                            Tap to upload video
                          </p>
                          <p className="text-[10px] text-gray-500 px-2">
                            Video files only, 10MB max
                          </p>
                        </>
                      )}
                    </div>
                  </label>
                </div>

                {/* Second Row: Three Image Upload Cards */}
                <div className="grid grid-cols-3 gap-2">
                  {[0, 1, 2].map((index) => (
                    <div key={index}>
                      <label className="cursor-pointer block">
                        <input
                          type="file"
                          ref={imageFileInputRefs[index]}
                          accept="image/*"
                          onChange={handleImageFileSelect(index)}
                          className="hidden"
                          disabled={!!imageFiles[index]}
                        />
                        <div className={cn(
                          "border-2 border-dashed rounded-lg p-1.5 sm:p-2 text-center transition-all duration-200",
                          "h-20 sm:h-24",
                          imageFiles[index]
                            ? "border-green-300 bg-green-50" 
                            : requiresAttachments() && !imageFiles[index] && !singleFile && imageFiles.every(f => !f)
                            ? "border-red-300 bg-red-50 hover:border-red-400"
                            : "border-gray-300 hover:border-indigo-500 hover:bg-indigo-50 active:bg-indigo-100"
                        )}>
                          {imageFiles[index] ? (
                            <div className="h-full flex flex-col">
                              <div className="flex-1 flex items-center justify-center mb-1">
                                <div className="w-6 h-6 sm:w-7 sm:h-7 bg-green-100 rounded-lg flex items-center justify-center">
                                  <FileText className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                                </div>
                              </div>
                              <div className="flex-1 flex flex-col justify-end">
                                <p className="text-[9px] sm:text-[10px] font-medium text-gray-900 truncate mb-0.5">
                                  {imageFiles[index]?.name}
                                </p>
                                <p className="text-[8px] sm:text-[9px] text-gray-500 mb-1">
                                  {imageFiles[index] ? formatFileSize(imageFiles[index].size) : ''}
                                </p>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    handleRemoveImageFile(index)
                                  }}
                                  className="w-full py-0.5 text-[9px] sm:text-[10px] bg-red-100 hover:bg-red-200 text-red-600 rounded transition-colors"
                                  aria-label="Remove image"
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="h-full flex flex-col items-center justify-center">
                              <div className="inline-flex items-center justify-center w-6 h-6 sm:w-7 sm:h-7 bg-indigo-100 rounded-full mb-1">
                                <Upload className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-indigo-600" />
                              </div>
                              <p className="text-[9px] sm:text-[10px] font-medium text-gray-900 mb-0.5">
                                Image {index + 1}
                              </p>
                              <p className="text-[8px] sm:text-[9px] text-gray-500">
                                10MB max
                              </p>
                            </div>
                          )}
                        </div>
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200" />

            {/* Trust Badges */}
            <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-lg p-2.5 sm:p-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                <div>
                  <div className="inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-white rounded-full mb-1 shadow-sm">
                    <Zap className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-indigo-600" />
                  </div>
                  <p className="text-xs font-semibold text-gray-900">Fast Response</p>
                  <p className="text-[10px] text-gray-600">Usually within 2 hours</p>
                </div>
                <div>
                  <div className="inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-white rounded-full mb-1 shadow-sm">
                    <Shield className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-600" />
                  </div>
                  <p className="text-xs font-semibold text-gray-900">Secure & Private</p>
                  <p className="text-[10px] text-gray-600">Your data is protected</p>
                </div>
                <div>
                  <div className="inline-flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 bg-white rounded-full mb-1 shadow-sm">
                    <CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-purple-600" />
                  </div>
                  <p className="text-xs font-semibold text-gray-900">Expert Support</p>
                  <p className="text-[10px] text-gray-600">Experienced agents ready</p>
                </div>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                "w-full py-2.5 sm:py-3 px-6 rounded-lg font-semibold text-white transition-all duration-200 text-sm",
                "focus:outline-none focus:ring-2 sm:focus:ring-4 focus:ring-indigo-300 touch-manipulation",
                isSubmitting
                  ? "bg-gray-400 cursor-not-allowed"
                  : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 active:from-indigo-800 active:to-purple-800 shadow-lg hover:shadow-xl active:scale-[0.98]"
              )}
            >
              {isSubmitting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Submitting Ticket...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-2">
                  Submit Ticket
                  <CheckCircle className="w-4 h-4 sm:w-5 sm:h-5" />
                </span>
              )}
            </button>
          </form>
        </div>

        {/* Additional Help Section */}
        <div className="mt-4 sm:mt-8 text-center px-2">
          <p className="text-xs sm:text-sm text-gray-600">
            Need immediate help? Call{' '}
            <a href="tel:+15551234567" className="text-indigo-600 hover:text-indigo-700 font-medium underline">
              +1 (555) 123-4567
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

// Success Screen Component
function SuccessScreen({ ticketNumber, ticketId, token }: { ticketNumber: string; ticketId: string; token: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 via-white to-indigo-50 flex items-center justify-center px-3 sm:px-4 py-4 sm:py-8">
      <div className="max-w-md w-full text-center">
        <div className="bg-white rounded-2xl sm:rounded-3xl shadow-2xl p-6 sm:p-8 md:p-12">
          {/* Success Animation */}
          <div className="inline-flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 md:w-24 md:h-24 bg-gradient-to-br from-green-500 to-emerald-600 rounded-full mb-4 sm:mb-6 animate-bounce">
            <CheckCircle className="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 text-white" />
          </div>
          
          <h2 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 mb-2 sm:mb-3 px-2">
            Ticket Submitted Successfully!
          </h2>
          
          <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6 px-2">
            We&apos;ve received your ticket and sent a confirmation to your email. 
            Our team will get back to you shortly.
          </p>

          <div className="bg-indigo-50 rounded-xl sm:rounded-2xl p-4 sm:p-6 mb-4 sm:mb-6">
            <p className="text-xs sm:text-sm text-gray-700 mb-1.5 sm:mb-2">
              Your Ticket ID
            </p>
            <p className="text-2xl sm:text-3xl font-bold text-indigo-600 break-all">
              {ticketNumber}
            </p>
          </div>

          <p className="text-xs sm:text-sm text-gray-500 mb-4 sm:mb-6 px-2">
            Redirecting you to your ticket in 3 seconds...
          </p>

          <div className="flex flex-col gap-2 sm:gap-3">
            <Link
              href={`/tickets/${ticketId}?token=${token}`}
              className="px-4 sm:px-6 py-2.5 sm:py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg sm:rounded-xl font-semibold hover:shadow-lg active:scale-[0.98] transition-all text-sm sm:text-base touch-manipulation"
            >
              View Your Ticket
            </Link>
            <Link
              href="/tickets/new"
              className="px-4 sm:px-6 py-2.5 sm:py-3 text-gray-600 hover:text-gray-900 font-medium text-sm sm:text-base touch-manipulation"
            >
              Submit Another Ticket
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
