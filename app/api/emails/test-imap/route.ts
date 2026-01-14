import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import Imap from 'imap'

export const dynamic = 'force-dynamic'

/**
 * Test IMAP connection
 * POST /api/emails/test-imap
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
    const { storeId } = body

    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      )
    }

    // Get IMAP credentials from SystemSettings
    // First try store-specific settings, then fall back to tenant-level settings
    let settings = await prisma.systemSettings.findMany({
      where: {
        tenantId,
        storeId: storeId || null,
        key: {
          in: ['IMAP_EMAIL', 'IMAP_APP_PASSWORD'],
        },
      },
    })

    // If store-specific settings are incomplete, try tenant-level settings
    const hasImapEmail = settings.some(s => s.key === 'IMAP_EMAIL')
    const hasImapPassword = settings.some(s => s.key === 'IMAP_APP_PASSWORD')
    
    if ((!hasImapEmail || !hasImapPassword) && storeId) {
      const tenantSettings = await prisma.systemSettings.findMany({
        where: {
          tenantId,
          storeId: null,
          key: {
            in: ['IMAP_EMAIL', 'IMAP_APP_PASSWORD'],
          },
        },
      })
      
      const existingKeys = new Set(settings.map(s => s.key))
      tenantSettings.forEach(setting => {
        if (!existingKeys.has(setting.key)) {
          settings.push(setting)
        }
      })
    }

    const configMap: Record<string, string> = {}
    settings.forEach((setting) => {
      configMap[setting.key] = setting.value
    })

    const imapEmail = configMap.IMAP_EMAIL
    const imapAppPassword = configMap.IMAP_APP_PASSWORD

    if (!imapEmail || !imapAppPassword) {
      return NextResponse.json(
        {
          error: 'IMAP credentials not configured. Please configure IMAP_EMAIL and IMAP_APP_PASSWORD in Email Integrations settings.',
        },
        { status: 400 }
      )
    }

    // Test IMAP connection
    return new Promise<NextResponse>((resolve) => {
      const imap = new Imap({
        user: imapEmail,
        password: imapAppPassword,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        tlsOptions: { rejectUnauthorized: false },
        connTimeout: 10000,
        authTimeout: 10000,
      })

      const timeout = setTimeout(() => {
        imap.end()
        resolve(
          NextResponse.json(
            { error: 'Connection timeout. Please check your credentials and internet connection.' },
            { status: 500 }
          )
        )
      }, 15000)

      imap.once('ready', () => {
        clearTimeout(timeout)
        imap.openBox('INBOX', true, (err, box) => {
          imap.end()
          
          if (err) {
            resolve(
              NextResponse.json(
                { error: `Failed to open INBOX: ${err.message}` },
                { status: 500 }
              )
            )
            return
          }

          resolve(
            NextResponse.json({
              success: true,
              message: `IMAP connection successful! Found ${box.messages.total} total messages, ${box.messages.new} unread.`,
              stats: {
                total: box.messages.total,
                unread: box.messages.new,
              },
            })
          )
        })
      })

      imap.once('error', (err: Error) => {
        clearTimeout(timeout)
        imap.end()
        
        let errorMessage = err.message
        if (errorMessage.includes('authentication') || errorMessage.includes('Invalid credentials')) {
          errorMessage = 'Gmail authentication failed. Please check your email and app password.'
        } else if (errorMessage.includes('timeout')) {
          errorMessage = 'Connection timeout. Please check your internet connection.'
        } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
          errorMessage = 'Could not connect to Gmail IMAP server. Please check your internet connection.'
        }

        resolve(
          NextResponse.json(
            { error: errorMessage },
            { status: 500 }
          )
        )
      })

      imap.connect()
    })
  } catch (error: any) {
    console.error('[IMAP Test] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to test IMAP connection' },
      { status: 500 }
    )
  }
}
