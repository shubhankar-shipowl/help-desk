import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * Public API to get Support Email for a store
 * No authentication required - used on public ticket page
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')

    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      )
    }

    // Get store to find tenantId
    const store = await prisma.store.findFirst({
      where: {
        id: storeId,
        isActive: true,
      },
      select: {
        id: true,
        tenantId: true,
      },
    })

    if (!store) {
      return NextResponse.json(
        { error: 'Store not found' },
        { status: 404 }
      )
    }

    // Fetch support email (store-specific first, then tenant-level)
    // First try store-specific setting
    const storeSetting = await prisma.systemSettings.findFirst({
      where: {
        tenantId: store.tenantId,
        storeId: storeId,
        key: 'SUPPORT_EMAIL',
      },
    })

    let supportEmail = ''
    if (storeSetting) {
      supportEmail = storeSetting.value
    } else {
      // If no store-specific setting, try tenant-level
      const tenantSetting = await prisma.systemSettings.findFirst({
        where: {
          tenantId: store.tenantId,
          storeId: null,
          key: 'SUPPORT_EMAIL',
        },
      })
      if (tenantSetting) {
        supportEmail = tenantSetting.value
      }
    }

    return NextResponse.json({
      supportEmail: supportEmail || '',
    })
  } catch (error: any) {
    console.error('Error fetching support email:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch support email' },
      { status: 500 }
    )
  }
}
