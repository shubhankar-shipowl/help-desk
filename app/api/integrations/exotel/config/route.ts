import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Get Exotel configuration from SystemSettings
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

    // Fetch all Exotel-related settings
    const settings = await prisma.systemSettings.findMany({
      where: {
        tenantId,
        key: {
          in: [
            'EXOTEL_KEY',
            'EXOTEL_TOKEN',
            'EXOTEL_SID',
            'CALLER_ID',
            'FLOW_URL',
            'SERVER_URL',
          ],
        },
      },
    })

    // Convert array to object
    const config: Record<string, string> = {}
    settings.forEach((setting) => {
      config[setting.key] = setting.value
    })

    return NextResponse.json({ config })
  } catch (error: any) {
    console.error('Error fetching Exotel config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch configuration' },
      { status: 500 }
    )
  }
}

/**
 * Save Exotel configuration to SystemSettings
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
    const {
      exotelKey,
      exotelToken,
      exotelSid,
      callerId,
      flowUrl,
      serverUrl,
    } = body

    // Validate required fields
    if (!exotelKey || !exotelToken || !exotelSid || !callerId) {
      return NextResponse.json(
        { error: 'Exotel Key, Token, SID, and Caller ID are required' },
        { status: 400 }
      )
    }

    // Save or update each setting
    const settingsToSave = [
      { key: 'EXOTEL_KEY', value: exotelKey },
      { key: 'EXOTEL_TOKEN', value: exotelToken },
      { key: 'EXOTEL_SID', value: exotelSid },
      { key: 'CALLER_ID', value: callerId },
      { key: 'FLOW_URL', value: flowUrl || '' },
      { key: 'SERVER_URL', value: serverUrl || '' },
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
      message: 'Exotel configuration saved successfully',
    })
  } catch (error: any) {
    console.error('Error saving Exotel config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save configuration' },
      { status: 500 }
    )
  }
}

