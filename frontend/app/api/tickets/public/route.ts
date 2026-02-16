import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateTicketNumber } from '@/lib/utils'
import { autoAssignTicket, sendTicketAcknowledgment } from '@/lib/automation'
import { triggerTicketCreated } from '@/lib/notification-client'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import { uploadFileToMega } from '@/lib/storage/mega'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''
    let name: string
    let email: string
    let phone: string
    let order: string
    let trackingId: string
    let subject: string
    let description: string
    let categoryId: string
    let priority: string
    let attachments: File[] = []

    let storeId: string | null = null

    // Check if request is FormData (file upload) or JSON
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      name = (formData.get('name') as string) || ''
      email = (formData.get('email') as string) || ''
      phone = (formData.get('phone') as string) || ''
      order = (formData.get('order') as string) || ''
      trackingId = (formData.get('trackingId') as string) || ''
      subject = (formData.get('subject') as string) || ''
      description = (formData.get('description') as string) || ''
      categoryId = (formData.get('categoryId') as string) || ''
      priority = (formData.get('priority') as string) || 'NORMAL'
      storeId = (formData.get('storeId') as string) || null
      
      // Handle file attachments
      const files = formData.getAll('attachments') as File[]
      attachments = files.filter(file => file instanceof File && file.size > 0)
    } else {
      const body = await req.json()
      name = body.name
      email = body.email
      phone = body.phone || ''
      order = body.order || ''
      trackingId = body.trackingId || ''
      subject = body.subject
      description = body.description
      categoryId = body.categoryId || ''
      priority = body.priority || 'NORMAL'
      storeId = body.storeId || null
    }

    // Validate required fields
    if (!name || !email || !phone || !subject || !description || !order || !trackingId) {
      return NextResponse.json(
        { error: 'Name, email, phone number, order ID, tracking ID, subject, and description are required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Detect tenant from domain/subdomain or email domain
    // For public routes, we need to determine which tenant this belongs to
    let tenantId: string | null = null
    
    // Option 1: Try to get tenant from subdomain
    const hostname = req.headers.get('host') || ''
    const subdomain = hostname.split('.')[0]
    const tenant = await prisma.tenant.findUnique({
      where: { slug: subdomain },
    })
    
    if (tenant) {
      tenantId = tenant.id
    } else {
      // Option 2: Try to get tenant from customer's email (if customer exists)
      const existingCustomer = await prisma.user.findFirst({
        where: { email },
        include: { Tenant: true },
      })
      
      if (existingCustomer?.tenantId) {
        tenantId = existingCustomer.tenantId
      } else {
        // Option 3: Use default tenant (fallback)
        const defaultTenant = await prisma.tenant.findUnique({
          where: { slug: 'default' },
        })
        tenantId = defaultTenant?.id || null
      }
    }

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Unable to determine tenant. Please contact support.' },
        { status: 400 }
      )
    }

    // Find or create customer in this tenant
    let customer = await prisma.user.findFirst({
      where: {
        tenantId,
        email,
      },
    })

    if (!customer) {
      // Create a new customer account without password
      // Customers cannot login - they can only create tickets
      customer = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          tenantId, // Always include tenantId
          email,
          name,
          phone: phone, // Phone is now mandatory
          password: null, // No password - customers cannot login
          role: 'CUSTOMER',
          isActive: true,
          updatedAt: new Date(),
        },
      })
    } else {
      // Update existing customer info if provided
      const updateData: { name?: string; phone?: string } = {}
      if (name && customer.name !== name) {
        updateData.name = name
      }
      if (phone && customer.phone !== phone) {
        updateData.phone = phone
      }
      if (Object.keys(updateData).length > 0) {
        customer = await prisma.user.update({
          where: { id: customer.id },
          data: updateData,
        })
      }
    }

    // Validate storeId if provided (must belong to the tenant)
    if (storeId) {
      const store = await prisma.store.findFirst({
        where: {
          id: storeId,
          tenantId,
          isActive: true,
        },
      })
      
      if (!store) {
        return NextResponse.json(
          { error: 'Invalid store ID or store does not belong to this tenant' },
          { status: 400 }
        )
      }
    }

    // Create ticket with order ID and tracking ID in description
    // Include order ID and tracking ID at the beginning of description for easy reference
    const descriptionWithOrder = `Order ID: ${order}\nTracking ID: ${trackingId}\n\n${description}`
    
    const ticket = await prisma.ticket.create({
      data: {
        id: crypto.randomUUID(),
        tenantId, // Always include tenantId
        storeId: storeId || null, // Include storeId if provided
        ticketNumber: generateTicketNumber(),
        subject,
        description: descriptionWithOrder,
        categoryId: categoryId || null,
        priority: (priority || 'NORMAL') as 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT',
        customerId: customer.id,
        status: 'NEW',
        updatedAt: new Date(),
      },
      include: {
        Category: true,
        User_Ticket_customerIdToUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    // Auto-assign ticket
    const assignedAgent = await autoAssignTicket(ticket.id)

    // Trigger notifications via notification service (non-blocking)
    // This also emits ticket:created WebSocket event to agents/admins
    triggerTicketCreated(ticket.id).catch((err: any) => console.error('[Public Ticket] Notification trigger failed:', err))

    // Track uploaded files for response
    let uploadedFiles: Array<{ filename: string; url: string; size: number; type: string }> = []
    
    // Handle file attachments in parallel (non-blocking)
    const fileUploadPromise = attachments.length > 0 ? (async () => {
      try {
        console.log(`\n📎 [Ticket ${ticket.ticketNumber}] Starting upload of ${attachments.length} file(s) to MEGA storage...`)
        
        // Upload files to MEGA storage and create attachment records in parallel
        const uploadResults = await Promise.allSettled(
          attachments
            .filter(file => file.size > 0)
            .map(async (file) => {
              try {
                const bytes = await file.arrayBuffer()
                const buffer = Buffer.from(bytes)
                
                console.log(`\n📤 [Ticket ${ticket.ticketNumber}] Uploading to MEGA: ${file.name} (${(file.size / 1024).toFixed(2)} KB)`)
                
                // Upload to MEGA storage
                const uploadResult = await uploadFileToMega(
                  buffer,
                  file.name,
                  file.type || 'application/octet-stream',
                  ticket.id
                )
                
                // Create attachment record with MEGA file URL
                await prisma.attachment.create({
                  data: {
                    id: crypto.randomUUID(),
                    filename: file.name,
                    fileUrl: uploadResult.fileUrl, // Stores /api/storage/mega/{fileHandle}
                    fileSize: uploadResult.fileSize,
                    mimeType: uploadResult.mimeType,
                    ticketId: ticket.id,
                  },
                })
                
                uploadedFiles.push({
                  filename: file.name,
                  url: uploadResult.fileUrl,
                  size: uploadResult.fileSize,
                  type: uploadResult.mimeType,
                })
                
                console.log(`✅ [Ticket ${ticket.ticketNumber}] Successfully uploaded to MEGA: ${file.name}`)
                console.log(`   🔗 URL: ${uploadResult.fileUrl}`)
                
                return { success: true, filename: file.name, url: uploadResult.fileUrl }
              } catch (fileError: any) {
                console.error(`❌ [Ticket ${ticket.ticketNumber}] Failed to upload ${file.name}:`, fileError.message)
                return { success: false, filename: file.name, error: fileError.message }
              }
            })
        )
        
        const successful = uploadResults.filter(r => r.status === 'fulfilled' && r.value.success).length
        const failed = uploadResults.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length
        
        console.log(`\n📊 [Ticket ${ticket.ticketNumber}] Upload Summary:`)
        console.log(`   ✅ Successful: ${successful}/${attachments.length}`)
        if (failed > 0) {
          console.log(`   ❌ Failed: ${failed}/${attachments.length}`)
        }
        console.log(`   📁 Storage: MEGA Cloud Storage`)
        console.log(`\n`)
      } catch (error: any) {
        console.error(`\n❌ [Ticket ${ticket.ticketNumber}] Error in file upload process:`, error.message)
        console.error(error.stack)
      }
    })() : Promise.resolve()

    // Send acknowledgment email (non-blocking - don't await)
    const emailPromise = sendTicketAcknowledgment(ticket.id).catch((error: any) => {
      console.error('[Public Ticket] Error sending acknowledgment email:', error)
    })

    // Generate a token for ticket tracking (without login)
    // This allows users to view their ticket without logging in
    const trackingToken = crypto.randomBytes(32).toString('hex')
    
    // Return response immediately - background tasks will continue
    // Wait only for file uploads to complete (they're fast)
    await fileUploadPromise
    
    // Background tasks (don't await - let them run in background):
    // - emailPromise (sending acknowledgment email)
    // - triggerTicketCreated (notifications + WebSocket events via notification-service)

    // Fetch attachments to include in response
    const ticketAttachments = await prisma.attachment.findMany({
      where: { ticketId: ticket.id },
      select: {
        id: true,
        filename: true,
        fileUrl: true,
        fileSize: true,
        mimeType: true,
      },
    })

    return NextResponse.json(
      {
        ticket: {
          ...ticket,
          attachments: ticketAttachments,
        },
        token: trackingToken,
        message: 'Ticket created successfully. You can track it using the ticket number.',
        uploads: {
          total: attachments.length,
          successful: uploadedFiles.length,
          files: uploadedFiles.map(f => ({
            filename: f.filename,
            url: f.url,
            size: f.size,
            type: f.type,
          })),
        },
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Error creating public ticket:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create ticket' },
      { status: 500 }
    )
  }
}

