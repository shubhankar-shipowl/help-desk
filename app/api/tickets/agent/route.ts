import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateTicketNumber } from '@/lib/utils'
import { autoAssignTicket, sendTicketAcknowledgment } from '@/lib/automation'
import { writeFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
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
          tenantId, // Always include tenantId
          email,
          name,
          phone: phone,
          password: null, // No password - customers cannot login
          role: 'CUSTOMER',
          isActive: true,
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
        tenantId, // Always include tenantId
        ticketNumber: generateTicketNumber(),
        subject,
        description: descriptionWithOrder,
        categoryId: categoryId || null,
        priority: priority || 'NORMAL',
        customerId: customer.id,
        status: 'NEW',
      },
      include: {
        category: true,
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    // Upload files to local storage and create attachments if any
    if (fileBuffers.length > 0) {
      try {
        // Create ticket-specific folder
        const ticketFolderPath = join(process.cwd(), 'uploads', 'tickets', ticket.id)
        if (!existsSync(ticketFolderPath)) {
          await mkdir(ticketFolderPath, { recursive: true })
        }
        
        // Upload files to local storage and create attachment records in parallel
        await Promise.all(
          fileBuffers.map(async (fileData) => {
            // Generate unique filename to avoid conflicts
            const timestamp = Date.now()
            const randomId = crypto.randomUUID()
            const sanitizedName = fileData.filename.replace(/[^a-zA-Z0-9.-]/g, '_')
            const filename = `${timestamp}_${randomId}_${sanitizedName}`
            
            // Save file to local storage
            const filePath = join(ticketFolderPath, filename)
            await writeFile(filePath, fileData.buffer)
            
            // Generate public URL
            const publicUrl = `/api/uploads/tickets/${ticket.id}/${filename}`
            
            // Create attachment record with local file URL
            await prisma.attachment.create({
              data: {
                filename: fileData.filename,
                fileUrl: publicUrl,
                fileSize: fileData.size,
                mimeType: fileData.mimeType,
                ticketId: ticket.id,
              },
            })
          })
        )
        
        console.log(`✅ Successfully uploaded ${fileBuffers.length} file(s) to local storage for ticket ${ticket.id}`)
      } catch (error) {
        console.error('[Agent Ticket] Error uploading files to local storage:', error)
      }
    }

    // Auto-assign ticket
    const assignedAgent = await autoAssignTicket(ticket.id)

    // Fetch full ticket with relations for notifications
    const fullTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: {
        customer: true,
        category: true,
        assignedAgent: true,
        attachments: true,
      },
    })

    if (fullTicket) {
      // Trigger notification using notification service
      // Note: onTicketAssigned was already called by autoAssignTicket, so we don't call it again
      const { ticketNotificationTriggers } = await import('@/lib/notifications/triggers/ticketTriggers')
      await ticketNotificationTriggers.onTicketCreated(fullTicket)
    }

    // Send acknowledgment email
    await sendTicketAcknowledgment(ticket.id)

    // Emit real-time ticket creation event via WebSocket
    try {
      const { getIO } = await import('@/lib/notifications/websocket')
      const io = getIO()
      
      if (io && fullTicket) {
        // Fetch ticket with all relations for WebSocket event
        const ticketForEvent = await prisma.ticket.findUnique({
          where: { id: ticket.id },
          include: {
            customer: {
              select: { id: true, name: true, email: true, avatar: true },
            },
            category: true,
            assignedAgent: {
              select: { id: true, name: true, email: true, avatar: true },
            },
            _count: {
              select: { comments: true, attachments: true },
            },
          },
        })

        if (ticketForEvent) {
          // Emit to all agents and admins
          io.to('agents').emit('ticket:created', {
            ticket: ticketForEvent,
          })
          io.to('admins').emit('ticket:created', {
            ticket: ticketForEvent,
          })
        }
      }
    } catch (error) {
      console.error('Error emitting ticket creation via WebSocket:', error)
    }

    return NextResponse.json({
      success: true,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        category: ticket.category,
        customer: ticket.customer,
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

