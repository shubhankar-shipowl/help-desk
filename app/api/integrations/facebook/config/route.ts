import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { clearSystemSettingsCache } from '@/lib/system-settings'
import crypto from 'crypto'

/**
 * Get Facebook configuration from SystemSettings
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Get storeId from query parameter (optional)
    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId') || null

    // Fetch all Facebook-related settings (store-specific first, then tenant-level)
    const settings = await prisma.systemSettings.findMany({
      where: {
        tenantId,
        storeId: storeId || null,
        key: {
          in: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_WEBHOOK_VERIFY_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN'],
        },
      },
    })

    // Convert array to object
    const config: Record<string, string> = {}
    settings.forEach((setting) => {
      config[setting.key] = setting.value
    })

    return NextResponse.json({
      config: {
        facebookAppId: config.FACEBOOK_APP_ID || '',
        facebookAppSecret: config.FACEBOOK_APP_SECRET || '',
        facebookWebhookVerifyToken: config.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '',
        facebookPageAccessToken: config.FACEBOOK_PAGE_ACCESS_TOKEN || '',
      },
    })
  } catch (error: any) {
    console.error('Error fetching Facebook config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch configuration' },
      { status: 500 }
    )
  }
}

/**
 * Save Facebook configuration to SystemSettings
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { facebookAppId, facebookAppSecret, facebookWebhookVerifyToken, facebookPageAccessToken, storeId } = body

    // Validate required fields
    if (!facebookAppId || !facebookAppSecret) {
      return NextResponse.json(
        { error: 'Facebook App ID and App Secret are required' },
        { status: 400 }
      )
    }

    // Validate App ID format
    const trimmedAppId = facebookAppId.trim()
    if (!/^\d{15,20}$/.test(trimmedAppId)) {
      return NextResponse.json(
        { error: 'Facebook App ID should be 15-20 digits (numeric only)' },
        { status: 400 }
      )
    }

    // Save or update each setting (store-specific if storeId provided)
    const settingsToSave = [
      { key: 'FACEBOOK_APP_ID', value: trimmedAppId },
      { key: 'FACEBOOK_APP_SECRET', value: facebookAppSecret },
      { key: 'FACEBOOK_WEBHOOK_VERIFY_TOKEN', value: facebookWebhookVerifyToken || 'fb_verify_2025' },
      { key: 'FACEBOOK_PAGE_ACCESS_TOKEN', value: facebookPageAccessToken || '' },
    ]

    for (const setting of settingsToSave) {
      // Find existing setting
      const existing = await prisma.systemSettings.findFirst({
        where: {
          tenantId,
          storeId: storeId || null,
          key: setting.key,
        },
      })

      if (existing) {
        await prisma.systemSettings.update({
          where: { id: existing.id },
          data: { value: setting.value },
        })
      } else {
        await prisma.systemSettings.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            storeId: storeId || null,
            key: setting.key,
            value: setting.value,
            updatedAt: new Date(),
          },
        })
      }
    }

    // Clear the cache after saving settings
    clearSystemSettingsCache(tenantId, storeId || null)
    console.log('[Facebook Config] Cleared cache after saving settings')

    return NextResponse.json({
      success: true,
      message: 'Facebook configuration saved successfully',
    })
  } catch (error: any) {
    console.error('Error saving Facebook config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save configuration' },
      { status: 500 }
    )
  }
}

