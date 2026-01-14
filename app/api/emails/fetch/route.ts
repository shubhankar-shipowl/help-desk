import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { fetchAndStoreGmailEmails, FetchOptions } from '@/lib/imap/gmail-fetcher'

export const dynamic = 'force-dynamic'

/**
 * Fetch emails from Gmail using IMAP
 * POST /api/emails/fetch
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
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
    const { storeId, mode = 'unread', limit } = body

    // For admins, storeId is required
    if (session.user.role === 'ADMIN' && !storeId) {
      return NextResponse.json(
        { error: 'Store ID is required for admin users' },
        { status: 400 }
      )
    }

    // Validate storeId if provided
    if (storeId) {
      const store = await prisma.store.findFirst({
        where: {
          id: storeId,
          tenantId,
          isActive: true,
        },
      })

      if (!store) {
        return NextResponse.json(
          { error: 'Invalid store ID or store does not belong to this tenant' },
          { status: 400 }
        )
      }
    }

    // Get IMAP credentials from SystemSettings
    // First try store-specific settings, then fall back to tenant-level settings
    console.log(`[IMAP Fetch] Fetching IMAP settings for tenantId: ${tenantId}, storeId: ${storeId || 'null'}`)
    
    // First, try to get store-specific settings
    let settings = await prisma.systemSettings.findMany({
      where: {
        tenantId,
        storeId: storeId || null,
        key: {
          in: ['IMAP_EMAIL', 'IMAP_APP_PASSWORD'],
        },
      },
    })

    console.log(`[IMAP Fetch] Found ${settings.length} store-specific settings:`, settings.map(s => s.key))

    // If store-specific settings are incomplete, try tenant-level settings
    const hasImapEmail = settings.some(s => s.key === 'IMAP_EMAIL')
    const hasImapPassword = settings.some(s => s.key === 'IMAP_APP_PASSWORD')
    
    if ((!hasImapEmail || !hasImapPassword) && storeId) {
      console.log(`[IMAP Fetch] Store-specific settings incomplete, trying tenant-level settings...`)
      const tenantSettings = await prisma.systemSettings.findMany({
        where: {
          tenantId,
          storeId: null, // Tenant-level settings
          key: {
            in: ['IMAP_EMAIL', 'IMAP_APP_PASSWORD'],
          },
        },
      })
      
      console.log(`[IMAP Fetch] Found ${tenantSettings.length} tenant-level settings:`, tenantSettings.map(s => s.key))
      
      // Merge settings: store-specific override tenant-level
      const existingKeys = new Set(settings.map(s => s.key))
      tenantSettings.forEach(setting => {
        if (!existingKeys.has(setting.key)) {
          settings.push(setting)
        }
      })
    }

    console.log(`[IMAP Fetch] Total settings found: ${settings.length}`, settings.map(s => `${s.key} (storeId: ${s.storeId || 'null'})`))

    const configMap: Record<string, string> = {}
    settings.forEach((setting) => {
      configMap[setting.key] = setting.value
    })

    const imapEmail = configMap.IMAP_EMAIL
    const imapAppPassword = configMap.IMAP_APP_PASSWORD

    console.log(`[IMAP Fetch] IMAP Email configured: ${imapEmail ? 'Yes' : 'No'}, App Password configured: ${imapAppPassword ? 'Yes' : 'No'}`)

    if (!imapEmail || !imapAppPassword) {
      console.error('[IMAP Fetch] IMAP credentials missing:', { imapEmail: !!imapEmail, imapAppPassword: !!imapAppPassword })
      return NextResponse.json(
        {
          error: 'IMAP credentials not configured. Please configure IMAP_EMAIL and IMAP_APP_PASSWORD in Email Integrations settings.',
        },
        { status: 400 }
      )
    }

    // Build fetch options
    // Default to 200 emails for both 'latest' and 'unread' modes for performance
    const fetchOptions: FetchOptions = {
      mode: mode === 'latest' ? 'latest' : 'unread',
      limit: limit || 200, // Default 200 for both modes
    }

    // Fetch and store emails
    console.log(`[IMAP Fetch] Starting email fetch with options:`, fetchOptions)
    
    try {
      const result = await fetchAndStoreGmailEmails(
        {
          email: imapEmail,
          appPassword: imapAppPassword,
          tenantId,
          storeId: storeId || null,
        },
        fetchOptions
      )

      console.log(`[IMAP Fetch] Fetch completed:`, result)

      return NextResponse.json({
        success: true,
        message: `Fetched ${result.fetched} emails, stored ${result.stored} new emails`,
        stats: result,
      })
    } catch (fetchError: any) {
      console.error('[IMAP Fetch] Error during fetchAndStoreGmailEmails:', fetchError)
      throw fetchError // Re-throw to be caught by outer catch
    }
  } catch (error: any) {
    console.error('[IMAP Fetch] Error:', error)
    
    // Provide user-friendly error messages
    let errorMessage = error.message || 'Failed to fetch emails'
    
    if (errorMessage.includes('authentication') || errorMessage.includes('Invalid credentials')) {
      errorMessage = 'Gmail authentication failed. Please check your email and app password.'
    } else if (errorMessage.includes('timeout')) {
      errorMessage = 'Connection timeout. Please try again.'
    } else if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('ECONNREFUSED')) {
      errorMessage = 'Could not connect to Gmail IMAP server. Please check your internet connection.'
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    )
  }
}
