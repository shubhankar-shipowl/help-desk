import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { triggerNewReply } from '@/lib/notification-client'
import { findOrCreateThreadId } from '@/lib/email-threading'

export const dynamic = 'force-dynamic'

/**
 * Email Webhook Endpoint
 * Receives incoming email replies and adds them to ticket conversations
 * 
 * Supports multiple email service providers:
 * - SendGrid (webhook format)
 * - Mailgun (webhook format)
 * - Generic POST with email data
 */
export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') || ''
    let emailData: any = {}

    // Parse request body based on content type
    if (contentType.includes('application/json')) {
      emailData = await req.json()
    } else if (contentType.includes('application/x-www-form-urlencoded')) {
      const formData = await req.formData()
      emailData = Object.fromEntries(formData.entries())
    } else {
      // Try to parse as JSON first, then form data
      try {
        emailData = await req.json()
      } catch {
        const formData = await req.formData()
        emailData = Object.fromEntries(formData.entries())
      }
    }

    console.log('[Email Webhook] Received email:', {
      from: emailData.from || emailData.sender || emailData['envelope[from]'],
      subject: emailData.subject || emailData['subject'],
      hasHeaders: !!emailData.headers,
    })

    // Extract email information
    const fromEmail = emailData.from || emailData.sender || emailData['envelope[from]'] || emailData['from']
    const fromName = emailData.fromName || emailData['from-name'] || emailData['from_name'] || null
    const toEmail = emailData.to || emailData.recipient || emailData['envelope[to]'] || emailData['to'] || ''
    const subject = emailData.subject || emailData['subject'] || ''
    const textContent = emailData.text || emailData['body-plain'] || emailData['body_text'] || emailData['text'] || ''
    const htmlContent = emailData.html || emailData['body-html'] || emailData['body_html'] || emailData['html'] || ''
    const headers = emailData.headers || emailData['message-headers'] || {}

    // Parse headers if they're a string
    let parsedHeaders: Record<string, string> = {}
    if (typeof headers === 'string') {
      try {
        parsedHeaders = JSON.parse(headers)
      } catch {
        // Try parsing as array of [key, value] pairs (SendGrid format)
        try {
          const headerArray = JSON.parse(headers)
          if (Array.isArray(headerArray)) {
            headerArray.forEach(([key, value]: [string, string]) => {
              parsedHeaders[key.toLowerCase()] = value
            })
          }
        } catch {
          // Headers might be in a different format, skip parsing
        }
      }
    } else if (Array.isArray(headers)) {
      // SendGrid format: array of [key, value] pairs
      headers.forEach(([key, value]: [string, string]) => {
        parsedHeaders[key.toLowerCase()] = value
      })
    } else {
      parsedHeaders = headers
    }

    // Extract message ID from headers
    const messageId = parsedHeaders['message-id'] || parsedHeaders['Message-ID'] || emailData.messageId || emailData['message-id'] || `<${Date.now()}-${Math.random().toString(36).substring(7)}@email>`

    // Extract ticket ID from email headers or subject
    let ticketId: string | null = null
    let ticketNumber: string | null = null

    // Method 1: Extract from In-Reply-To or References header (contains Message-ID)
    const inReplyTo = parsedHeaders['in-reply-to'] || parsedHeaders['in_reply_to'] || parsedHeaders['In-Reply-To']
    const references = parsedHeaders['references'] || parsedHeaders['References']
    
    if (inReplyTo || references) {
      // Try In-Reply-To first (most recent message)
      if (inReplyTo) {
        const ticketIdMatch = inReplyTo.match(/ticket-([a-zA-Z0-9]+)-/)
        if (ticketIdMatch) {
          ticketId = ticketIdMatch[1]
        }
      }
      
      // If not found, try References header (contains all Message-IDs in thread)
      if (!ticketId && references) {
        // References can contain multiple Message-IDs separated by spaces
        const messageIds = references.split(/\s+/).filter(Boolean)
        for (const msgId of messageIds) {
          const ticketIdMatch = msgId.match(/ticket-([a-zA-Z0-9]+)-/)
          if (ticketIdMatch) {
            ticketId = ticketIdMatch[1]
            break // Use first match
          }
        }
      }
    }

    // Method 2: Extract from subject line (e.g., "Re: Ticket Created Successfully - TKT-2025-1223-584")
    if (!ticketId && subject) {
      const ticketNumberMatch = subject.match(/TKT-[\d-]+/i)
      if (ticketNumberMatch) {
        ticketNumber = ticketNumberMatch[0]
      }
      
      // Also try to extract ticket ID from subject if it contains Message-ID format
      if (!ticketId) {
        const subjectTicketIdMatch = subject.match(/ticket-([a-zA-Z0-9]+)-/i)
        if (subjectTicketIdMatch) {
          ticketId = subjectTicketIdMatch[1]
        }
      }
    }

    // Method 3: Extract from email body (some email clients include ticket info)
    if (!ticketId && !ticketNumber) {
      const bodyText = textContent || htmlContent.replace(/<[^>]*>/g, '')
      const ticketNumberMatch = bodyText.match(/TKT-[\d-]+/i)
      if (ticketNumberMatch) {
        ticketNumber = ticketNumberMatch[0]
      }
      
      // Also try to extract ticket ID from body if it contains Message-ID format
      if (!ticketId) {
        const bodyTicketIdMatch = bodyText.match(/ticket-([a-zA-Z0-9]+)-/i)
        if (bodyTicketIdMatch) {
          ticketId = bodyTicketIdMatch[1]
        }
      }
    }
    
    // Method 4: Try to find ticket by searching delivery logs for matching Message-IDs
    if (!ticketId && !ticketNumber && (inReplyTo || references)) {
      const allMessageIds = []
      if (inReplyTo) allMessageIds.push(inReplyTo)
      if (references) {
        allMessageIds.push(...references.split(/\s+/).filter(Boolean))
      }
      
      // Search for any Message-ID in delivery logs
      for (const msgId of allMessageIds) {
        const deliveryLog = await prisma.notificationDeliveryLog.findFirst({
          where: {
            messageId: msgId,
            channel: 'EMAIL',
            status: 'SENT',
          },
          include: {
            Notification: {
              select: {
                ticketId: true,
              },
            },
          },
        })
        
        if (deliveryLog?.Notification?.ticketId) {
          ticketId = deliveryLog.Notification.ticketId
          break
        }
      }
    }

    // Find ticket by ID or ticket number
    let ticket = null
    let tenantId: string | undefined
    let storeId: string | null = null
    
    if (ticketId) {
      ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: { User_Ticket_customerIdToUser: true },
      })
    } else if (ticketNumber) {
      // Use findFirst since ticketNumber is part of compound unique with tenantId
      ticket = await prisma.ticket.findFirst({
        where: { ticketNumber },
        include: { User_Ticket_customerIdToUser: true },
      })
    }

    // Get tenantId and storeId from ticket if found
    if (ticket) {
      tenantId = ticket.tenantId
      storeId = ticket.storeId
    } else {
      // Try to find default tenant if no ticket found
      const defaultTenant = await prisma.tenant.findFirst({
        where: { slug: 'default' },
      })
      tenantId = defaultTenant?.id
    }

    // Store email in database (even if ticket not found)
    if (tenantId && messageId) {
      try {
        // Check if email already exists
        const existingEmail = await prisma.email.findUnique({
          where: { messageId },
        })

        if (!existingEmail) {
          const emailId = crypto.randomUUID()
          
          // Compute threadId for this email
          const threadId = await findOrCreateThreadId(
            {
              messageId,
              subject,
              fromEmail,
              toEmail,
              headers: parsedHeaders,
              inReplyTo: parsedHeaders['in-reply-to'] || parsedHeaders['In-Reply-To'],
              references: parsedHeaders['references'] || parsedHeaders['References'],
            },
            tenantId,
            storeId
          )

          // Process inline images from HTML content
          let processedHtmlContent = htmlContent
          let hasInlineImages = false
          
          if (htmlContent) {
            try {
              // Import inline image processor
              const { processInlineImages } = await import('@/lib/email-inline-images')
              
              const { processedHtml, uploadedImages } = await processInlineImages(
                htmlContent,
                emailId,
                undefined // Webhook doesn't have parsed attachments, so inline images must be data URIs
              )
              
              if (processedHtml) {
                processedHtmlContent = processedHtml
              }
              
              // Store inline images as EmailAttachment records
              for (const image of uploadedImages as any[]) {
                try {
                  await prisma.emailAttachment.create({
                    data: {
                      id: crypto.randomUUID(),
                      emailId: emailId,
                      filename: image.filename,
                      mimeType: image.mimeType,
                      size: image.size,
                      fileUrl: image.fileUrl,
                      fileHandle: image.fileHandle,
                    },
                  })
                  hasInlineImages = true
                } catch (error) {
                  console.error('[Email Webhook] Error storing inline image:', error)
                }
              }
            } catch (error) {
              console.error('[Email Webhook] Error processing inline images:', error)
              // Continue with original HTML if processing fails
            }
          }

          await prisma.email.create({
            data: {
              id: emailId,
              tenantId,
              storeId,
              messageId,
              threadId,
              fromEmail,
              fromName,
              toEmail,
              subject,
              textContent,
              htmlContent: processedHtmlContent,
              headers: parsedHeaders,
              ticketId: ticket?.id || null,
              processed: !!ticket,
              processedAt: ticket ? new Date() : null,
              hasAttachments: hasInlineImages,
              updatedAt: new Date(),
            },
          })
        }
      } catch (error: any) {
        // Log error but don't fail the webhook
        console.error('[Email Webhook] Error storing email:', error)
      }
    }

    if (!ticket) {
      console.warn('[Email Webhook] Ticket not found:', {
        ticketId,
        ticketNumber,
        subject,
        fromEmail,
      })
      return NextResponse.json(
        { error: 'Ticket not found', received: true },
        { status: 404 }
      )
    }

    // Verify the sender is the ticket customer
    const customerEmail = ticket.User_Ticket_customerIdToUser?.email
    if (!customerEmail || customerEmail.toLowerCase() !== fromEmail.toLowerCase()) {
      console.warn('[Email Webhook] Email sender does not match ticket customer:', {
        senderEmail: fromEmail,
        customerEmail: customerEmail || 'unknown',
        ticketId: ticket.id,
      })
      return NextResponse.json(
        { error: 'Unauthorized: Email sender does not match ticket customer', received: true },
        { status: 403 }
      )
    }

    // Extract reply content (remove quoted text)
    let replyContent = textContent || htmlContent.replace(/<[^>]*>/g, '')
    
    // Remove common email reply patterns
    replyContent = replyContent
      .replace(/^On .+ wrote:.*$/gm, '') // "On [date] [person] wrote:"
      .replace(/^From:.*$/gm, '') // "From: [email]"
      .replace(/^Sent:.*$/gm, '') // "Sent: [date]"
      .replace(/^To:.*$/gm, '') // "To: [email]"
      .replace(/^Subject:.*$/gm, '') // "Subject: [subject]"
      .replace(/^>.*$/gm, '') // Quoted lines starting with >
      .replace(/^-----Original Message-----.*$/s, '') // Original message separator
      .trim()

    // If content is empty after cleaning, use original text
    if (!replyContent || replyContent.length < 3) {
      replyContent = textContent || htmlContent.replace(/<[^>]*>/g, '').substring(0, 1000)
    }

    if (!replyContent || replyContent.trim().length === 0) {
      console.warn('[Email Webhook] Empty reply content:', {
        ticketId: ticket.id,
        fromEmail,
      })
      return NextResponse.json(
        { error: 'Empty reply content', received: true },
        { status: 400 }
      )
    }

    // Find or create customer user
    // Use findFirst since email is part of compound unique with tenantId
    // For email webhooks, we'll search across all tenants and use the first match
    let customer = await prisma.user.findFirst({
      where: { 
        email: fromEmail,
        role: 'CUSTOMER',
      },
    })

    if (!customer) {
      // Get tenantId from ticket if available, otherwise use default tenant
      let tenantId: string | undefined
      if (ticket) {
        tenantId = ticket.tenantId
      } else {
        // Try to find default tenant
        const defaultTenant = await prisma.tenant.findFirst({
          where: { slug: 'default' },
        })
        tenantId = defaultTenant?.id
      }
      
      if (!tenantId) {
        return NextResponse.json(
          { error: 'Unable to determine tenant for customer creation' },
          { status: 400 }
        )
      }
      
      // Create customer if doesn't exist
      customer = await prisma.user.create({
        data: {
          id: crypto.randomUUID(),
          tenantId,
          email: fromEmail,
          name: fromEmail.split('@')[0], // Use email prefix as name
          role: 'CUSTOMER',
          isActive: true,
          updatedAt: new Date(),
        },
      })
    }

    // Handle email attachments if present
    const attachments: Array<{ filename: string; fileUrl: string; fileSize: number; mimeType: string }> = []
    
    // Check for attachments in email data (format varies by email service)
    const attachmentData = emailData.attachments || emailData['attachment-info'] || emailData['attachment-count']
    
    if (attachmentData && typeof attachmentData === 'object') {
      // Process attachments based on email service format
      // This is a simplified version - actual implementation depends on your email service
      console.log('[Email Webhook] Attachments found:', Object.keys(attachmentData))
    }

    // Update email record to mark as processed
    if (messageId) {
      try {
        await prisma.email.updateMany({
          where: { messageId },
          data: {
            processed: true,
            processedAt: new Date(),
            ticketId: ticket.id,
          },
        })
      } catch (error: any) {
        console.error('[Email Webhook] Error updating email:', error)
      }
    }

    // Create comment from email reply
    const commentNow = new Date()
    const comment = await prisma.comment.create({
      data: {
        id: crypto.randomUUID(),
        content: replyContent.trim(),
        ticketId: ticket.id,
        authorId: customer.id,
        isInternal: false,
        createdAt: commentNow,
        updatedAt: commentNow,
      },
      include: {
        User: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
      },
    })

    // Trigger notification via notification service (non-blocking)
    triggerNewReply(ticket.id, comment.id)
      .catch((err: any) => console.error('[Email Webhook] New reply notification failed:', err))

    console.log('[Email Webhook] ✅ Reply added to ticket:', {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      commentId: comment.id,
      fromEmail,
    })

    return NextResponse.json({
      success: true,
      message: 'Reply added to ticket',
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      commentId: comment.id,
    })
  } catch (error: any) {
    console.error('[Email Webhook] Error processing email:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process email', received: true },
      { status: 500 }
    )
  }
}

// GET endpoint for webhook verification (some email services use GET for verification)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const verifyToken = searchParams.get('verify_token')
  
  // Return 200 OK for webhook verification
  return NextResponse.json({ status: 'ok', verified: true })
}

