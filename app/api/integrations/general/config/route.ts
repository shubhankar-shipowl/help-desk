import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Get General configuration from SystemSettings
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

    // Fetch all general-related settings
        const settings = await prisma.systemSettings.findMany({
          where: {
            tenantId,
            key: {
              in: ['COMPANY_ADDRESS', 'SUPPORT_PHONE'],
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
        companyAddress: config.COMPANY_ADDRESS || '',
        supportPhone: config.SUPPORT_PHONE || '',
      },
    })
  } catch (error: any) {
    console.error('Error fetching general config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch configuration' },
      { status: 500 }
    )
  }
}

/**
 * Save General configuration to SystemSettings
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
    const { companyAddress, supportPhone } = body

    // Save or update each setting
    const settingsToSave = [
      { key: 'COMPANY_ADDRESS', value: companyAddress || '' },
      { key: 'SUPPORT_PHONE', value: supportPhone || '' },
    ]

    for (const setting of settingsToSave) {
      await prisma.systemSettings.upsert({
        where: {
          tenantId_key: {
            tenantId,
            key: setting.key,
          },
        },
        update: {
          value: setting.value,
        },
        create: {
          tenantId,
          key: setting.key,
          value: setting.value,
        },
      })
    }

    return NextResponse.json({
      success: true,
      message: 'General configuration saved successfully',
    })
  } catch (error: any) {
    console.error('Error saving general config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save configuration' },
      { status: 500 }
    )
  }
}

