import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { NotificationType } from '@prisma/client'

// Facebook webhook verification
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  const verifyToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN

  if (mode === 'subscribe' && token === verifyToken) {
    return new NextResponse(challenge, { status: 200 })
  }

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Facebook webhook handler
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Facebook sends entries array
    if (body.object === 'page' && body.entry) {
      for (const entry of body.entry) {
        // Handle page posts
        if (entry.messaging) {
          for (const event of entry.messaging) {
            await handleFacebookMessage(event, entry.id)
          }
        }

        // Handle page posts
        if (entry.changes) {
          for (const change of entry.changes) {
            if (change.value) {
              await handleFacebookChange(change, entry.id)
            }
          }
        }
      }
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error: any) {
    console.error('Error processing Facebook webhook:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to process webhook' },
      { status: 500 }
    )
  }
}

async function handleFacebookMessage(event: any, pageId: string) {
  // Use findFirst since pageId is part of compound unique with tenantId
  const integration = await prisma.facebookIntegration.findFirst({
    where: { pageId, isActive: true },
  })

  if (!integration || !integration.isActive) {
    return
  }

  // Get all admin users to notify
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
  })

  for (const admin of admins) {
    const notification = await prisma.notification.create({
      data: {
        type: NotificationType.FACEBOOK_MESSAGE,
        title: 'New Facebook Message',
        message: `New message from ${event.sender?.id || 'Facebook user'}`,
        userId: admin.id,
        metadata: {
          pageId,
          senderId: event.sender?.id,
          message: event.message?.text,
          timestamp: event.timestamp,
        },
      },
    })

    await prisma.facebookNotification.create({
      data: {
        type: 'MESSAGE',
        facebookId: event.sender?.id || '',
        content: event.message?.text || '',
        author: 'Facebook User',
        postUrl: `https://facebook.com/messages/${event.sender?.id}`,
        notificationId: notification.id,
      },
    })
  }
}

async function handleFacebookChange(change: any, pageId: string) {
  // Use findFirst since pageId is part of compound unique with tenantId
  const integration = await prisma.facebookIntegration.findFirst({
    where: { pageId, isActive: true },
  })

  if (!integration || !integration.isActive) {
    return
  }

  // Handle post creation
  if (change.field === 'feed' && change.value.item === 'post') {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
    })

    for (const admin of admins) {
      const notification = await prisma.notification.create({
        data: {
          type: NotificationType.FACEBOOK_POST,
          title: 'New Facebook Post',
          message: `New post on your Facebook page`,
          userId: admin.id,
          metadata: {
            pageId,
            postId: change.value.post_id,
            message: change.value.message,
          },
        },
      })

      await prisma.facebookNotification.create({
        data: {
          type: 'POST',
          facebookId: change.value.post_id,
          facebookPostId: change.value.post_id,
          content: change.value.message || '',
          author: change.value.from?.name || 'Facebook User',
          postUrl: `https://facebook.com/${change.value.post_id}`,
          notificationId: notification.id,
        },
      })
    }
  }

  // Handle comments
  if (change.field === 'feed' && change.value.item === 'comment') {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN' },
    })

    for (const admin of admins) {
      const notification = await prisma.notification.create({
        data: {
          type: NotificationType.FACEBOOK_COMMENT,
          title: 'New Facebook Comment',
          message: `New comment on your Facebook post`,
          userId: admin.id,
          metadata: {
            pageId,
            postId: change.value.post_id,
            commentId: change.value.comment_id,
            message: change.value.message,
          },
        },
      })

      await prisma.facebookNotification.create({
        data: {
          type: 'COMMENT',
          facebookId: change.value.comment_id,
          facebookPostId: change.value.post_id,
          content: change.value.message || '',
          author: change.value.from?.name || 'Facebook User',
          postUrl: `https://facebook.com/${change.value.post_id}`,
          notificationId: notification.id,
        },
      })
    }
  }
}

