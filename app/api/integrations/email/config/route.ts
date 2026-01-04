import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Get Email/SMTP configuration from SystemSettings
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

    // Fetch all SMTP-related settings
    const settings = await prisma.systemSettings.findMany({
      where: {
        tenantId,
        key: {
          in: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'],
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
        smtpHost: config.SMTP_HOST || '',
        smtpPort: config.SMTP_PORT || '587',
        smtpUser: config.SMTP_USER || '',
        smtpPassword: config.SMTP_PASSWORD || '',
      },
    })
  } catch (error: any) {
    console.error('Error fetching email config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch configuration' },
      { status: 500 }
    )
  }
}

/**
 * Save Email/SMTP configuration to SystemSettings
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
    const { smtpHost, smtpPort, smtpUser, smtpPassword } = body

    // Validate required fields
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
      return NextResponse.json(
        { error: 'All SMTP fields are required' },
        { status: 400 }
      )
    }

    // Validate port
    const port = parseInt(smtpPort)
    if (isNaN(port) || port < 1 || port > 65535) {
      return NextResponse.json(
        { error: 'SMTP Port must be a valid number between 1 and 65535' },
        { status: 400 }
      )
    }

    // Save or update each setting
    const settingsToSave = [
      { key: 'SMTP_HOST', value: smtpHost },
      { key: 'SMTP_PORT', value: smtpPort },
      { key: 'SMTP_USER', value: smtpUser },
      { key: 'SMTP_PASSWORD', value: smtpPassword },
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
      message: 'Email configuration saved successfully',
    })
  } catch (error: any) {
    console.error('Error saving email config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save configuration' },
      { status: 500 }
    )
  }
}

