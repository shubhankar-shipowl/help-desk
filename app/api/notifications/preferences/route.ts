import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { notificationService } from '@/lib/notifications/NotificationService'

export const dynamic = 'force-dynamic'

// Get user preferences
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const preferences = await notificationService.getUserPreferences(session.user.id)

    return NextResponse.json({ preferences })
  } catch (error: any) {
    console.error('Error fetching preferences:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch preferences' },
      { status: 500 }
    )
  }
}

// Update preference
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { notificationType, ...updates } = body

    if (!notificationType) {
      return NextResponse.json(
        { error: 'notificationType is required' },
        { status: 400 }
      )
    }

    const preference = await prisma.notificationPreference.upsert({
      where: {
        userId_notificationType: {
          userId: session.user.id,
          notificationType,
        },
      },
      update: updates,
      create: {
        userId: session.user.id,
        notificationType,
        ...updates,
      },
    })

    return NextResponse.json({ success: true, preference })
  } catch (error: any) {
    console.error('Error updating preference:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update preference' },
      { status: 500 }
    )
  }
}

