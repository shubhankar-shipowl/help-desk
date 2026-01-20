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

    // Get the original email
    const originalEmail = await prisma.email.findUnique({
      where: { id: params.id },
    })

    if (!originalEmail) {
      return NextResponse.json(
        { error: 'Email not found' },
        { status: 404 }
      )
    }

    // Get storeId from original email or session
    const storeId = originalEmail.storeId || (session.user as any).storeId || null

    // Send the reply email
    const emailResult = await sendEmail({
      to: toEmail,
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      html: replyBody.replace(/\n/g, '<br>'),
      text: replyBody,
      inReplyTo: originalEmail.messageId ? `<${originalEmail.messageId}>` : undefined,
      references: originalEmail.messageId ? `<${originalEmail.messageId}>` : undefined,
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

    // Create EmailReply record
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
        inReplyTo: originalEmail.messageId ? `<${originalEmail.messageId}>` : null,
        references: originalEmail.messageId ? `<${originalEmail.messageId}>` : null,
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
