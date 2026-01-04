import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notificationService } from '@/lib/notifications/NotificationService'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || !session.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const userId = session.user.id

    if (!userId || typeof userId !== 'string') {
      console.error('Invalid user ID:', userId)
      return NextResponse.json(
        { error: 'Invalid user session' },
        { status: 401 }
      )
    }

    const count = await notificationService.getUnreadCount(userId)

    return NextResponse.json({ count: count || 0 })
  } catch (error: any) {
    console.error('Error fetching unread count:', error)
    console.error('Error details:', {
      message: error.message,
      code: error.code,
      meta: error.meta,
      stack: error.stack,
    })
    return NextResponse.json(
      {
        error: error.message || 'Failed to fetch unread count',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
      { status: 500 }
    )
  }
}

