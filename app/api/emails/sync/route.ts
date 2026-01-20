import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import {
  startGmailSync,
  stopGmailSync,
  getGmailSyncStatus,
  isGmailSyncRunning,
  getAllActiveSyncs,
} from '@/lib/imap/gmail-sync-service'
import { getSystemSetting } from '@/lib/system-settings'

export const dynamic = 'force-dynamic'

/**
 * Get sync status
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')

    if (!storeId) {
      // Return all active syncs for admin
      if (session.user.role === 'ADMIN') {
        const activeSyncs = getAllActiveSyncs()
        return NextResponse.json({
          activeSyncs,
          count: activeSyncs.length,
        })
      }
      return NextResponse.json({ error: 'Store ID is required' }, { status: 400 })
    }

    const status = getGmailSyncStatus(storeId)
    const isRunning = isGmailSyncRunning(storeId)

    return NextResponse.json({
      storeId,
      isRunning,
      status,
    })
  } catch (error: any) {
    console.error('Error getting sync status:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to get sync status' },
      { status: 500 }
    )
  }
}

/**
 * Start or stop sync
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
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
    const { action, storeId } = body

    if (!storeId) {
      return NextResponse.json({ error: 'Store ID is required' }, { status: 400 })
    }

    if (!action || !['start', 'stop'].includes(action)) {
      return NextResponse.json(
        { error: 'Invalid action. Use "start" or "stop"' },
        { status: 400 }
      )
    }

    if (action === 'stop') {
      stopGmailSync(storeId)
      return NextResponse.json({
        success: true,
        message: 'Gmail sync stopped',
        isRunning: false,
      })
    }

    // Action is 'start' - get email config from system settings
    // Keys are IMAP_EMAIL and IMAP_APP_PASSWORD (uppercase with underscores)
    const [imapEmail, imapAppPassword] = await Promise.all([
      getSystemSetting('IMAP_EMAIL', tenantId, storeId),
      getSystemSetting('IMAP_APP_PASSWORD', tenantId, storeId),
    ])

    if (!imapEmail || !imapAppPassword) {
      return NextResponse.json(
        { error: 'Email integration not configured. Please configure IMAP settings first.' },
        { status: 400 }
      )
    }

    // Check if already running
    if (isGmailSyncRunning(storeId)) {
      return NextResponse.json({
        success: true,
        message: 'Gmail sync already running',
        isRunning: true,
        status: getGmailSyncStatus(storeId),
      })
    }

    // Start sync
    await startGmailSync(storeId, {
      email: imapEmail,
      appPassword: imapAppPassword,
      tenantId,
    })

    return NextResponse.json({
      success: true,
      message: 'Gmail sync started',
      isRunning: true,
      status: getGmailSyncStatus(storeId),
    })
  } catch (error: any) {
    console.error('Error managing sync:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to manage sync' },
      { status: 500 }
    )
  }
}
