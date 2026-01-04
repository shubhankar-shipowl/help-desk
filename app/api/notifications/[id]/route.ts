import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { notificationService } from '@/lib/notifications/NotificationService'

export const dynamic = 'force-dynamic'

// Mark notification as read
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await Promise.resolve(params)
    const notification = await notificationService.markAsRead(resolvedParams.id, session.user.id)

    return NextResponse.json({ success: true, notification })
  } catch (error: any) {
    console.error('Error marking notification as read:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to mark notification as read' },
      { status: 500 }
    )
  }
}

// Delete notification
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only ADMIN users can delete notifications
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only administrators can delete notifications' },
        { status: 403 }
      )
    }

    const resolvedParams = await Promise.resolve(params)
    await notificationService.deleteNotification(resolvedParams.id, session.user.id)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting notification:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete notification' },
      { status: 500 }
    )
  }
}

