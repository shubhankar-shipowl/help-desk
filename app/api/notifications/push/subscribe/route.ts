import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { endpoint, keys } = body

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      return NextResponse.json(
        { error: 'endpoint and keys (p256dh, auth) are required' },
        { status: 400 }
      )
    }

    // Check if subscription already exists
    const existing = await prisma.pushSubscription.findFirst({
      where: {
        userId: session.user.id,
        endpoint,
      },
    })

    if (existing) {
      // Update existing subscription
      const subscription = await prisma.pushSubscription.update({
        where: { id: existing.id },
        data: {
          p256dh: keys.p256dh,
          auth: keys.auth,
          isActive: true,
          lastUsedAt: new Date(),
        },
      })

      return NextResponse.json({ success: true, subscription })
    }

    // Create new subscription
    const subscription = await prisma.pushSubscription.create({
      data: {
        id: crypto.randomUUID(),
        userId: session.user.id,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: req.headers.get('user-agent') || undefined,
        isActive: true,
        lastUsedAt: new Date(),
      },
    })

    return NextResponse.json({ success: true, subscription })
  } catch (error: any) {
    console.error('Error subscribing to push:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to subscribe to push notifications' },
      { status: 500 }
    )
  }
}

