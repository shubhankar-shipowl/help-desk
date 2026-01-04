import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get Facebook integration status
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get the most recent integration (active or inactive)
    // This allows admins to see and configure integrations even if they're temporarily inactive
    const integration = await prisma.facebookIntegration.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        pageId: true,
        pageName: true,
        isActive: true,
        notificationSettings: true,
        autoCreateSettings: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ integration })
  } catch (error: any) {
    console.error('Error fetching Facebook integration:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch integration' },
      { status: 500 }
    )
  }
}

