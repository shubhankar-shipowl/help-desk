import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const pageId = searchParams.get('pageId')

    if (!pageId) {
      return NextResponse.json({ error: 'Page ID is required' }, { status: 400 })
    }

    // Find the integration
    const integration = await prisma.facebookIntegration.findUnique({
      where: { pageId },
    })

    if (!integration) {
      return NextResponse.json({ error: 'Integration not found' }, { status: 404 })
    }

    // Optionally unsubscribe from webhook via Facebook API
    try {
      const unsubscribeResponse = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}/subscribed_apps?access_token=${integration.accessToken}`,
        {
          method: 'DELETE',
        }
      )
      
      if (unsubscribeResponse.ok) {
        console.log(`[Facebook Disconnect] Unsubscribed page ${pageId} from webhook`)
      } else {
        const errorData = await unsubscribeResponse.json().catch(() => ({}))
        console.warn(`[Facebook Disconnect] Failed to unsubscribe from Facebook:`, errorData)
        // Continue with deletion even if Facebook unsubscribe fails
      }
    } catch (fbError: any) {
      console.warn(`[Facebook Disconnect] Error unsubscribing from Facebook:`, fbError.message)
      // Continue with deletion even if Facebook unsubscribe fails
    }

    // Delete the integration
    await prisma.facebookIntegration.delete({
      where: { pageId },
    })

    console.log(`[Facebook Disconnect] Deleted integration for page ${pageId}`)

    return NextResponse.json({ 
      success: true,
      message: 'Facebook page disconnected successfully' 
    })
  } catch (error: any) {
    console.error('Error disconnecting Facebook page:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to disconnect Facebook page' },
      { status: 500 }
    )
  }
}

