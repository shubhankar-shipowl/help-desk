import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateTicketNumber } from '@/lib/utils'
import { autoAssignTicket, sendTicketAcknowledgment } from '@/lib/automation'
import { triggerTicketCreated } from '@/lib/notification-client'
import { uploadFileToMega } from '@/lib/storage/mega'
import crypto from 'crypto'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    // Only agents and admins can create tickets on behalf of customers
    if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const contentType = req.headers.get('content-type') || ''
    let name: string
    let email: string
    let phone: string
    let order: string
    let trackingId: string
    let subject: string
    let description: string
    let categoryId: string | null
    let priority: string
    const attachments: Array<{ filename: string; fileUrl: string; fileSize: number; mimeType: string }> = []
    const fileBuffers: Array<{ buffer: Buffer; filename: string; mimeType: string; size: number }> = []

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      
      name = formData.get('name') as string
      email = formData.get('email') as string
      phone = formData.get('phone') as string
      order = formData.get('order') as string
      trackingId = formData.get('trackingId') as string
      subject = formData.get('subject') as string
      description = formData.get('description') as string
      categoryId = formData.get('categoryId') as string || null
      priority = (formData.get('priority') as string) || 'NORMAL'

      // Collect file buffers for later upload to local storage
      const files = formData.getAll('attachments') as File[]
      if (files.length > 0) {
        for (const file of files) {
          if (file.size > 0) {
            const bytes = await file.arrayBuffer()
            const buffer = Buffer.from(bytes)
            
            fileBuffers.push({
              buffer,
              filename: file.name,
              mimeType: file.type || 'application/octet-stream',
              size: file.size,
            })
          }
        }
      }
    } else {
      const body = await req.json()
      name = body.name
      email = body.email
      phone = body.phone
      order = body.order
      trackingId = body.trackingId
      subject = body.subject
      description = body.description
      categoryId = body.categoryId || null
      priority = body.priority || 'NORMAL'
    }

    // Validate required fields
    if (!name || !email || !phone || !order || !trackingId || !subject || !description) {
      return NextResponse.json(
        { error: 'All fields are required' },
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

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
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
          phone: phone,
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

    // Create ticket with order ID and tracking ID in description
    // Include order ID and tracking ID at the beginning of description for easy reference
    const descriptionWithOrder = `Order ID: ${order}\nTracking ID: ${trackingId}\n\n${description}`
    
    const ticket = await prisma.ticket.create({
      data: {
        id: crypto.randomUUID(),
        tenantId, // Always include tenantId
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

    // Upload files to MEGA storage and create attachments if any
    if (fileBuffers.length > 0) {
      try {
        console.log(`📤 Uploading ${fileBuffers.length} file(s) to MEGA storage for ticket ${ticket.id}`)
        
        // Upload files to MEGA storage and create attachment records in parallel
        await Promise.all(
          fileBuffers.map(async (fileData) => {
            // Upload to MEGA storage
            const uploadResult = await uploadFileToMega(
              fileData.buffer,
              fileData.filename,
              fileData.mimeType,
              ticket.id
            )
            
            // Create attachment record with MEGA file URL
            await prisma.attachment.create({
              data: {
                id: crypto.randomUUID(),
                filename: fileData.filename,
                fileUrl: uploadResult.fileUrl, // Stores /api/storage/mega/{fileHandle}
                fileSize: uploadResult.fileSize,
                mimeType: uploadResult.mimeType,
                ticketId: ticket.id,
              },
            })
          })
        )
        
        console.log(`✅ Successfully uploaded ${fileBuffers.length} file(s) to MEGA storage for ticket ${ticket.id}`)
      } catch (error) {
        console.error('[Agent Ticket] Error uploading files to MEGA storage:', error)
      }
    }

    // Auto-assign ticket
    const assignedAgent = await autoAssignTicket(ticket.id)

    // Fetch full ticket with relations for notifications
    const fullTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: {
        User_Ticket_customerIdToUser: true,
        Category: true,
        User_Ticket_assignedAgentIdToUser: true,
        Attachment: true,
      },
    })

    // Trigger notification via notification service (non-blocking)
    // This also emits ticket:created WebSocket event to agents/admins
    triggerTicketCreated(ticket.id).catch(err => console.error('[Tickets] Notification trigger failed:', err))

    // Send acknowledgment email
    await sendTicketAcknowledgment(ticket.id)

    return NextResponse.json({
      success: true,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.Category,
        customer: ticket.User_Ticket_customerIdToUser,
        createdAt: ticket.createdAt,
      },
    })
  } catch (error: any) {
    console.error('Error creating ticket:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create ticket' },
      { status: 500 }
    )
  }
}

