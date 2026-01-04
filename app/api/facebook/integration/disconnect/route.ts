import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Disconnect Facebook integration
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find active integration
    const integration = await prisma.facebookIntegration.findFirst({
      where: { isActive: true },
    })

    if (!integration) {
      return NextResponse.json(
        { error: 'No active Facebook integration found' },
        { status: 404 }
      )
    }

    // Deactivate integration
    await prisma.facebookIntegration.update({
      where: { id: integration.id },
      data: {
        isActive: false,
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error disconnecting Facebook integration:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to disconnect' },
      { status: 500 }
    )
  }
}

