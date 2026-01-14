import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notificationService } from '@/lib/notifications/NotificationService'

export const dynamic = 'force-dynamic'

export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get storeId from query params
    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')

    const count = await notificationService.markAllAsRead(session.user.id, storeId || null)

    return NextResponse.json({ success: true, count })
  } catch (error: any) {
    console.error('Error marking all as read:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to mark all as read' },
      { status: 500 }
    )
  }
}

