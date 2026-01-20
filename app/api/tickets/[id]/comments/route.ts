import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { uploadFileToMega } from '@/lib/storage/mega'
import crypto from 'crypto'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await Promise.resolve(params)
    const contentType = req.headers.get('content-type') || ''

    let content: string
    let isInternal: boolean
    let attachments: File[] = []

    // Check if request is FormData (file upload) or JSON
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      content = (formData.get('content') as string) || ''
      isInternal = formData.get('isInternal') === 'true'
      
      // Handle file attachments
      const files = formData.getAll('attachments') as File[]
      attachments = files.filter(file => file instanceof File && file.size > 0)
    } else {
      const body = await req.json()
      content = body.content
      isInternal = body.isInternal
    }

    if (!content && attachments.length === 0) {
      return NextResponse.json(
        { error: 'Content or attachments are required' },
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

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: resolvedParams.id,
        tenantId, // Security: Only access tickets from same tenant
      },
      include: { User_Ticket_customerIdToUser: true, User_Ticket_assignedAgentIdToUser: true },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Check access
    if (session.user.role === 'CUSTOMER' && ticket.customerId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Customers cannot create internal notes
    if (isInternal && session.user.role === 'CUSTOMER') {
      return NextResponse.json(
        { error: 'Customers cannot create internal notes' },
        { status: 403 }
      )
    }

    const commentNow = new Date()
    const comment = await prisma.comment.create({
      data: {
        id: crypto.randomUUID(), // Generate unique ID
        content: content || 'Attachment only',
        isInternal: isInternal || false,
        ticketId: resolvedParams.id,
        authorId: session.user.id,
        createdAt: commentNow,
        updatedAt: commentNow,
      },
      include: {
        User: {
          select: { id: true, name: true, email: true, avatar: true, role: true },
        },
      },
    })

    // Handle file attachments
    if (attachments.length > 0) {
      try {
        console.log(`📤 Uploading ${attachments.length} attachment(s) to MEGA storage for comment ${comment.id}`)
        
        // Get ticket ID for organization
        const ticket = await prisma.ticket.findUnique({
          where: { id: resolvedParams.id },
          select: { id: true },
        })
        
        // Upload files to MEGA storage and create attachment records in parallel
        await Promise.all(
          attachments
            .filter(file => file.size > 0)
            .map(async (file) => {
              const bytes = await file.arrayBuffer()
              const buffer = Buffer.from(bytes)
              
              // Upload to MEGA storage
              const uploadResult = await uploadFileToMega(
                buffer,
                file.name,
                file.type || 'application/octet-stream',
                ticket?.id
              )
              
              // Create attachment record with MEGA file URL
              await prisma.attachment.create({
                data: {
                  id: crypto.randomUUID(), // Generate unique ID
                  filename: file.name,
                  fileUrl: uploadResult.fileUrl, // Stores /api/storage/mega/{fileHandle}
                  fileSize: uploadResult.fileSize,
                  mimeType: uploadResult.mimeType,
                  commentId: comment.id,
                },
              })
            })
        )
        
        console.log(`✅ Successfully uploaded ${attachments.length} file(s) to MEGA storage for comment ${comment.id}`)
      } catch (error) {
        console.error('[Comment] Error uploading files to MEGA storage:', error)
      }
    }

    // Update ticket status if customer replied
    if (session.user.role === 'CUSTOMER' && ticket.status === 'RESOLVED') {
      await prisma.ticket.update({
        where: { id: resolvedParams.id },
        data: { status: 'OPEN' },
      })
    } else if (session.user.role !== 'CUSTOMER' && ticket.status === 'NEW') {
      await prisma.ticket.update({
        where: { id: resolvedParams.id },
        data: { status: 'OPEN' },
      })
    }

    // Create notification using notification service
    const fullTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: {
        User_Ticket_customerIdToUser: true,
        User_Ticket_assignedAgentIdToUser: true,
        Category: true,
        Email: true, // Include linked emails
      },
    })

    if (fullTicket) {
      const fullComment = await prisma.comment.findUnique({
        where: { id: comment.id },
        include: {
          User: true,
        },
      })

      if (fullComment) {
        const { ticketNotificationTriggers } = await import('@/lib/notifications/triggers/ticketTriggers')
        await ticketNotificationTriggers.onNewReply(fullComment, fullTicket)
      }

      // Create EmailReply record if this is an agent reply and ticket was created from email
      if (!isInternal && session.user.role !== 'CUSTOMER') {
        // Find the original email that created this ticket
        const originalEmail = await prisma.email.findFirst({
          where: { ticketId: ticket.id },
          orderBy: { createdAt: 'asc' },
        })

        if (originalEmail) {
          try {
            const customerEmail = fullTicket.User_Ticket_customerIdToUser?.email
            if (customerEmail) {
              const replyNow = new Date()
              await prisma.emailReply.create({
                data: {
                  id: crypto.randomUUID(),
                  tenantId,
                  storeId: ticket.storeId || null,
                  originalEmailId: originalEmail.id,
                  ticketId: ticket.id,
                  sentBy: session.user.id,
                  toEmail: customerEmail,
                  subject: `Re: ${ticket.subject}`,
                  bodyText: content,
                  bodyHtml: null,
                  inReplyTo: fullTicket.originalEmailMessageId || null,
                  references: fullTicket.originalEmailMessageId || null,
                  status: 'SENT',
                  sentAt: replyNow,
                  createdAt: replyNow,
                  updatedAt: replyNow,
                },
              })
              console.log(`[Comments] ✅ EmailReply created for ticket ${ticket.ticketNumber}:`, {
                originalEmailId: originalEmail.id,
                toEmail: customerEmail,
                contentPreview: content.substring(0, 50),
              })
            }
          } catch (emailReplyError) {
            console.error('[Comments] Error creating EmailReply:', emailReplyError)
            // Don't fail the request if EmailReply creation fails
          }
        }
      }
    }

    return NextResponse.json({ comment }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating comment:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create comment' },
      { status: 500 }
    )
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const resolvedParams = await Promise.resolve(params)
    const ticket = await prisma.ticket.findFirst({
      where: {
        id: resolvedParams.id,
        tenantId, // Security: Only access tickets from same tenant
      },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Check access
    if (session.user.role === 'CUSTOMER' && ticket.customerId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const comments = await prisma.comment.findMany({
      where: {
        ticketId: resolvedParams.id,
        isInternal: session.user.role === 'CUSTOMER' ? false : undefined, // Customers can't see internal notes
      },
      include: {
        User: {
          select: { id: true, name: true, email: true, avatar: true, role: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return NextResponse.json({ comments })
  } catch (error: any) {
    console.error('Error fetching comments:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch comments' },
      { status: 500 }
    )
  }
}

