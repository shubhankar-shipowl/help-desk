import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { generateTicketNumber } from '@/lib/utils'
import { autoAssignTicket, sendTicketAcknowledgment } from '@/lib/automation'
import { uploadFileToMega } from '@/lib/storage/mega'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Create a ticket from an email
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const contentType = req.headers.get('content-type') || ''
    let name: string
    let customerEmail: string
    let phone: string
    let order: string
    let trackingId: string
    let subject: string
    let description: string
    let categoryId: string | null
    let priority: string
    let assignedAgentId: string | null = null
    const fileBuffers: Array<{ buffer: Buffer; filename: string; mimeType: string; size: number }> = []

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      
      name = formData.get('name') as string
      customerEmail = formData.get('email') as string
      phone = formData.get('phone') as string
      order = formData.get('order') as string
      trackingId = formData.get('trackingId') as string
      subject = formData.get('subject') as string
      description = formData.get('description') as string
      categoryId = formData.get('categoryId') as string || null
      priority = (formData.get('priority') as string) || 'NORMAL'
      assignedAgentId = formData.get('assignedAgentId') as string || null

      // Collect file buffers for later upload to MEGA
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
      customerEmail = body.email
      phone = body.phone
      order = body.order
      trackingId = body.trackingId
      subject = body.subject
      description = body.description
      categoryId = body.categoryId || null
      priority = body.priority || 'NORMAL'
      assignedAgentId = body.assignedAgentId || null
    }

    // Validate required fields
    if (!name || !customerEmail || !phone || !order || !trackingId || !subject || !description) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(customerEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Get the email
    const email = await prisma.email.findUnique({
      where: { id: params.id },
      include: {
        EmailAttachment: true,
      },
    })

    if (!email) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      )
    }

    // Check if email is already linked to a ticket
    if (email.ticketId) {
      // Verify the ticket actually exists
      const existingTicket = await prisma.ticket.findUnique({
        where: { id: email.ticketId },
      })
      
      if (existingTicket) {
        return NextResponse.json(
          { error: 'Email is already linked to a ticket', ticketId: email.ticketId },
          { status: 400 }
        )
      } else {
        // Ticket doesn't exist, clear the invalid ticketId
        await prisma.email.update({
          where: { id: email.id },
          data: { ticketId: null },
        })
        // Continue with ticket creation
      }
    }

    const storeId = email.storeId || (session.user as any).storeId || null

    // Find or create customer
    let customer = await prisma.user.findFirst({
      where: {
        email: customerEmail,
        tenantId,
        role: 'CUSTOMER',
      },
    })

    if (!customer) {
      // Create customer user
      const now = new Date()
      customer = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: customerEmail,
          name: name.trim(),
          phone: phone.trim(),
          role: 'CUSTOMER',
          tenantId,
          storeId,
          createdAt: now,
          updatedAt: now,
        },
      })
    } else {
      // Update customer info if provided
      await prisma.user.update({
        where: { id: customer.id },
        data: {
          name: name.trim(),
          phone: phone.trim(),
        },
      })
    }

    // Generate ticket number
    const ticketNumber = await generateTicketNumber(tenantId, storeId)

    // Create ticket
    const now = new Date()
    const ticket = await prisma.ticket.create({
      data: {
        id: randomUUID(),
        ticketNumber,
        tenantId,
        storeId,
        customerId: customer.id,
        subject: subject.trim(),
        description: description.trim(),
        categoryId: categoryId || null,
        priority: priority as any,
        assignedAgentId: assignedAgentId || null,
        status: 'NEW',
        source: 'EMAIL',
        createdAt: now,
        updatedAt: now,
      },
    })

    // Store order and tracking info in ticket metadata or as a comment
    const orderInfo = `Order ID: ${order}\nTracking ID: ${trackingId}`
    const fullDescription = `${description.trim()}\n\n---\n${orderInfo}`
    
    // Update ticket description to include order info
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { description: fullDescription },
    })

    // Link email to ticket and store Message-ID for future reply threading
    await prisma.email.update({
      where: { id: email.id },
      data: { ticketId: ticket.id },
    })

    // Store original email Message-ID for future reply threading
    if (email.messageId) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { originalEmailMessageId: email.messageId },
      })
    }

    // Copy email attachments to ticket attachments if any
    if (email.EmailAttachment && email.EmailAttachment.length > 0) {
      for (const attachment of email.EmailAttachment) {
        try {
          await prisma.ticketAttachment.create({
            data: {
              id: randomUUID(),
              ticketId: ticket.id,
              filename: attachment.filename,
              fileUrl: attachment.fileUrl,
              fileSize: attachment.size,
              mimeType: attachment.mimeType,
            },
          })
        } catch (attachError) {
          console.error('Error copying attachment to ticket:', attachError)
          // Continue with other attachments
        }
      }
    }

    // Upload and attach files from form if any
    if (fileBuffers.length > 0) {
      for (const fileBuffer of fileBuffers) {
        try {
          // Upload to MEGA
          const uploadResult = await uploadFileToMega(
            fileBuffer.buffer,
            fileBuffer.filename,
            fileBuffer.mimeType,
            ticket.id
          )

          if (uploadResult.success && uploadResult.fileUrl) {
            // Create ticket attachment record
            await prisma.ticketAttachment.create({
              data: {
                id: randomUUID(),
                ticketId: ticket.id,
                filename: fileBuffer.filename,
                fileUrl: uploadResult.fileUrl,
                fileSize: fileBuffer.size,
                mimeType: fileBuffer.mimeType,
              },
            })
          }
        } catch (fileError) {
          console.error('Error uploading file to ticket:', fileError)
          // Continue with other files
        }
      }
    }


    // Note: We don't create an initial comment here since the ticket description
    // already contains the email content. This prevents duplicate entries.

    // Auto-assign ticket if enabled
    if (!assignedAgentId) {
      await autoAssignTicket(ticket.id)
    }

    // Send acknowledgment email as a reply to the original email thread
    await sendTicketAcknowledgment(ticket.id, { inReplyTo: email.messageId || undefined })

    // Fetch full ticket with relations
    const fullTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: {
        User_Ticket_customerIdToUser: true,
        Category: true,
        User_Ticket_assignedAgentIdToUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    })

    // Transform ticket to use frontend-friendly field names
    const transformedTicket = fullTicket ? {
      ...fullTicket,
      customer: fullTicket.User_Ticket_customerIdToUser || null,
      category: fullTicket.Category || null,
      assignedAgent: fullTicket.User_Ticket_assignedAgentIdToUser || null,
    } : null

    return NextResponse.json({
      success: true,
      message: 'Ticket created successfully from email',
      ticket: transformedTicket,
    })
  } catch (error: any) {
    console.error('Error creating ticket from email:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create ticket from email' },
      { status: 500 }
    )
  }
}
