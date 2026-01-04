import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notificationService } from '@/lib/notifications/NotificationService'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '20')
    const read = searchParams.get('read') === 'true' ? true : searchParams.get('read') === 'false' ? false : undefined
    const type = searchParams.get('type') as any

    const result = await notificationService.getNotifications(session.user.id, {
      page,
      limit,
      read,
      type,
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error fetching notifications:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch notifications' },
      { status: 500 }
    )
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { notificationIds, read } = body

    if (!notificationIds || !Array.isArray(notificationIds)) {
      return NextResponse.json(
        { error: 'notificationIds array is required' },
        { status: 400 }
      )
    }

    // Mark each notification individually using the service
    for (const id of notificationIds) {
      if (read !== false) {
        await notificationService.markAsRead(id, session.user.id)
      }
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error updating notifications:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update notifications' },
      { status: 500 }
    )
  }
}

