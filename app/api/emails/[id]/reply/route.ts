import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Reply to an email
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

    const body = await req.json()
    const { subject, body: replyBody, toEmail, ccEmail } = body

    if (!subject || !replyBody || !toEmail) {
      return NextResponse.json(
        { error: 'Subject, body, and recipient email are required' },
        { status: 400 }
      )
    }

    // Get the original email with its thread information
    const originalEmail = await prisma.email.findUnique({
      where: { id: params.id },
      include: {
        EmailReply_EmailReply_originalEmailIdToEmail: {
          select: {
            inReplyTo: true,
            references: true,
            sentAt: true,
          },
          orderBy: { sentAt: 'asc' },
        },
      },
    })

    if (!originalEmail) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      )
    }

    // Get storeId from original email or session
    const storeId = originalEmail.storeId || (session.user as any).storeId || null

    // Build proper References header for threading
    // References should include: original email + all previous replies in the thread
    const referencesMessageIds: string[] = []
    
    // Add original email's messageId (if exists)
    if (originalEmail.messageId) {
      // Normalize messageId (remove angle brackets if present, then add them back)
      const normalizedMsgId = originalEmail.messageId.replace(/^<|>$/g, '').trim()
      referencesMessageIds.push(`<${normalizedMsgId}>`)
    }
    
    // Add original email's References header if it exists (to maintain full thread chain)
    if (originalEmail.headers) {
      const headers = originalEmail.headers as Record<string, any>
      const refsHeader = headers['references'] || headers['References'] || headers['reference']
      if (refsHeader) {
        // Parse existing References header and add to our list
        const existingRefs = String(refsHeader).split(/\s+/).filter(Boolean)
        existingRefs.forEach(ref => {
          const normalized = ref.replace(/^<|>$/g, '').trim()
          if (normalized && !referencesMessageIds.includes(`<${normalized}>`)) {
            referencesMessageIds.push(`<${normalized}>`)
          }
        })
      }
    }
    
    // Add messageIds from previous EmailReply records' References headers
    // Extract messageIds from previous replies' References headers to build complete thread chain
    originalEmail.EmailReply_EmailReply_originalEmailIdToEmail.forEach(reply => {
      if (reply.references) {
        // Parse References header from previous reply
        const refs = String(reply.references).split(/\s+/).filter(Boolean)
        refs.forEach(ref => {
          const normalized = ref.replace(/^<|>$/g, '').trim()
          if (normalized && !referencesMessageIds.includes(`<${normalized}>`)) {
            referencesMessageIds.push(`<${normalized}>`)
          }
        })
      }
      // Also add In-Reply-To from previous replies
      if (reply.inReplyTo) {
        const normalized = reply.inReplyTo.replace(/^<|>$/g, '').trim()
        if (normalized && !referencesMessageIds.includes(`<${normalized}>`)) {
          referencesMessageIds.push(`<${normalized}>`)
        }
      }
    })
    
    // Build References header string (space-separated)
    const referencesHeader = referencesMessageIds.length > 0 
      ? referencesMessageIds.join(' ') 
      : (originalEmail.messageId ? `<${originalEmail.messageId.replace(/^<|>$/g, '').trim()}>` : undefined)
    
    // In-Reply-To should be the most recent message in the thread (last reply or original email)
    const inReplyTo = referencesMessageIds.length > 0 
      ? referencesMessageIds[referencesMessageIds.length - 1] 
      : (originalEmail.messageId ? `<${originalEmail.messageId.replace(/^<|>$/g, '').trim()}>` : undefined)

    console.log(`[Email Reply] 📧 Threading headers:`, {
      originalMessageId: originalEmail.messageId,
      inReplyTo,
      references: referencesHeader?.substring(0, 200) + (referencesHeader && referencesHeader.length > 200 ? '...' : ''),
      previousReplies: originalEmail.EmailReply_EmailReply_originalEmailIdToEmail.length,
    })

    // Send the reply email
    const emailResult = await sendEmail({
      to: toEmail,
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      html: replyBody.replace(/\n/g, '<br>'),
      text: replyBody,
      inReplyTo,
      references: referencesHeader,
      tenantId,
      storeId,
    })

    if (!emailResult.success) {
      return NextResponse.json(
        { error: emailResult.error?.message || 'Failed to send email' },
        { status: 500 }
      )
    }

    // Mark the original email as read after replying
    await prisma.email.update({
      where: { id: originalEmail.id },
      data: { read: true },
    })

    // Create EmailReply record with proper threading headers
    const now = new Date()
    const emailReply = await prisma.emailReply.create({
      data: {
        id: randomUUID(),
        tenantId,
        storeId,
        originalEmailId: originalEmail.id,
        sentBy: session.user.id,
        toEmail: toEmail,
        ccEmail: ccEmail || null,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        bodyText: replyBody,
        bodyHtml: replyBody.replace(/\n/g, '<br>'),
        inReplyTo: inReplyTo || null,
        references: referencesHeader || null,
        status: 'SENT',
        sentAt: now,
        updatedAt: now,
      },
    })

    // If email is linked to a ticket, create a comment
    if (originalEmail.ticketId) {
      try {
        const commentNow = new Date()
        await prisma.comment.create({
          data: {
            id: randomUUID(),
            content: replyBody,
            ticketId: originalEmail.ticketId,
            authorId: session.user.id,
            isInternal: false,
            createdAt: commentNow,
            updatedAt: commentNow,
          },
        })
      } catch (commentError) {
        console.error('Error creating comment from email reply:', commentError)
        // Don't fail the request if comment creation fails
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Email reply sent successfully',
      emailReply,
    })
  } catch (error: any) {
    console.error('Error sending email reply:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to send email reply' },
      { status: 500 }
    )
  }
}
