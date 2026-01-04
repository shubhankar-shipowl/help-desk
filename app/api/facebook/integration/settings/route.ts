import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Update Facebook integration settings
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { notificationSettings, autoCreateSettings } = body

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

    // Update settings
    const updated = await prisma.facebookIntegration.update({
      where: { id: integration.id },
      data: {
        notificationSettings: notificationSettings || {},
        autoCreateSettings: autoCreateSettings || {},
      },
    })

    return NextResponse.json({
      success: true,
      integration: {
        id: updated.id,
        pageId: updated.pageId,
        pageName: updated.pageName,
        notificationSettings: updated.notificationSettings,
        autoCreateSettings: updated.autoCreateSettings,
      },
    })
  } catch (error: any) {
    console.error('Error updating Facebook integration settings:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update settings' },
      { status: 500 }
    )
  }
}

