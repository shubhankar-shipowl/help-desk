import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

/**
 * Get General Settings (Company Name, Support Email, Timezone, Business Hours)
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

    // Fetch all general settings (store-specific first, then tenant-level)
    const settings = await prisma.systemSettings.findMany({
      where: {
        tenantId,
        storeId: storeId || null,
        key: {
          in: ['COMPANY_NAME', 'SUPPORT_EMAIL', 'TIMEZONE', 'BUSINESS_HOURS'],
        },
      },
    })

    // Convert array to object
    const config: Record<string, string> = {}
    settings.forEach((setting: any) => {
      config[setting.key] = setting.value
    })

    // Parse business hours JSON if it exists
    let businessHours = {}
    if (config.BUSINESS_HOURS) {
      try {
        businessHours = JSON.parse(config.BUSINESS_HOURS)
      } catch (e) {
        console.error('Error parsing business hours:', e)
      }
    }

    return NextResponse.json({
      settings: {
        companyName: config.COMPANY_NAME || '',
        supportEmail: config.SUPPORT_EMAIL || '',
        timezone: config.TIMEZONE || 'America/New_York',
        businessHours: businessHours,
      },
    })
  } catch (error: any) {
    console.error('Error fetching general settings:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

/**
 * Save General Settings
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
    const { companyName, supportEmail, timezone, businessHours, storeId } = body

    // Validate required fields
    if (!companyName || !supportEmail) {
      return NextResponse.json(
        { error: 'Company Name and Support Email are required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(supportEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Save or update each setting (store-specific if storeId provided)
    const settingsToSave = [
      { key: 'COMPANY_NAME', value: companyName },
      { key: 'SUPPORT_EMAIL', value: supportEmail },
      { key: 'TIMEZONE', value: timezone || 'America/New_York' },
      { key: 'BUSINESS_HOURS', value: JSON.stringify(businessHours || {}) },
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

    return NextResponse.json({
      success: true,
      message: 'General settings saved successfully',
    })
  } catch (error: any) {
    console.error('Error saving general settings:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save settings' },
      { status: 500 }
    )
  }
}
