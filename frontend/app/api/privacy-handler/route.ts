import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAppUrl } from '@/lib/utils'
import { getSystemSetting } from '@/lib/system-settings'
import crypto from 'crypto'

// Force dynamic rendering
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// This route handles Facebook OAuth callbacks and webhook verification
// It's called from the privacy page when OAuth/webhook parameters are detected
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    
    // Check if this is a Facebook webhook verification request
    const hubMode = searchParams.get('hub.mode')
    const hubToken = searchParams.get('hub.verify_token')
    const hubChallenge = searchParams.get('hub.challenge')
    
    if (hubMode === 'subscribe') {
      // This is a webhook verification request
      console.log('[Facebook Webhook Verification] ========================================')
      console.log('[Facebook Webhook Verification] 📥 Incoming verification request')
      console.log('[Facebook Webhook Verification] Mode:', hubMode)
      console.log('[Facebook Webhook Verification] Token provided:', hubToken ? 'yes' : 'no')
      console.log('[Facebook Webhook Verification] Challenge provided:', hubChallenge ? 'yes' : 'no')
      
      // Collect all possible verify tokens
      let verifyTokens: string[] = []
      
      // Add environment variable token if set
      if (process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
        verifyTokens.push(process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN)
      }
      
      // Add default tokens
      verifyTokens.push('fb_verify_2025')
      verifyTokens.push('facebook_2026') // Add the token from Facebook config
      
      // Try to find verify tokens from SystemSettings
      try {
        const settings = await prisma.systemSettings.findMany({
          where: {
            key: 'FACEBOOK_WEBHOOK_VERIFY_TOKEN',
          },
        })
        
        if (settings.length > 0) {
          settings.forEach((setting: any) => {
            if (setting.value && !verifyTokens.includes(setting.value)) {
              verifyTokens.push(setting.value)
            }
          })
          console.log('[Facebook Webhook Verification] Found', settings.length, 'verify token(s) in SystemSettings')
        }
      } catch (error: any) {
        console.warn('[Facebook Webhook Verification] ⚠️ Could not fetch verify token from SystemSettings:', error.message)
      }
      
      // Remove duplicates
      verifyTokens = Array.from(new Set(verifyTokens.filter(Boolean)))
      
      console.log('[Facebook Webhook Verification] Checking against tokens:', verifyTokens.map(t => t.substring(0, 5) + '...'))
      console.log('[Facebook Webhook Verification] Received token:', hubToken || '(none)')
      
      // Check if token matches
      if (hubToken && verifyTokens.includes(hubToken)) {
        console.log('[Facebook Webhook Verification] ✅ Token matches!')
        console.log('[Facebook Webhook Verification] ✅ Verified successfully')
        console.log('[Facebook Webhook Verification] Returning challenge:', hubChallenge || '(empty)')
        console.log('[Facebook Webhook Verification] ========================================')
        
        // Return challenge as plain text with HTTP 200
        return new NextResponse(hubChallenge || '', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        })
      } else {
        console.log('[Facebook Webhook Verification] ❌ Token does not match')
        console.log('[Facebook Webhook Verification] Expected one of:', verifyTokens.map(t => t.substring(0, 5) + '...'))
        console.log('[Facebook Webhook Verification] Received:', hubToken || '(none)')
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
    
    // Check if this is an OAuth callback (Facebook redirects here with code/state/error)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    
    if (code || error) {
      // Handle OAuth callback
      if (error) {
        return NextResponse.redirect(
          `${getAppUrl()}/admin/integrations?error=${encodeURIComponent(error)}`
        )
      }

      if (!code) {
        return NextResponse.redirect(
          `${getAppUrl()}/admin/integrations?error=no_code`
        )
      }

      // Get tenantId from state (user ID) - we stored it in the OAuth state
      let tenantId: string | null = null
      if (state) {
        const user = await prisma.user.findUnique({
          where: { id: state },
          select: { tenantId: true },
        })
        tenantId = user?.tenantId || null
      }

      // Get Facebook configuration from SystemSettings (with fallback to environment variables)
      const appId = tenantId 
        ? (await getSystemSetting('FACEBOOK_APP_ID', tenantId) || process.env.FACEBOOK_APP_ID)
        : process.env.FACEBOOK_APP_ID
      const appSecret = tenantId
        ? (await getSystemSetting('FACEBOOK_APP_SECRET', tenantId) || process.env.FACEBOOK_APP_SECRET)
        : process.env.FACEBOOK_APP_SECRET
      
      // For Facebook OAuth, use APP_URL/NEXTAUTH_URL if set, otherwise use getAppUrl()
      let facebookBaseUrl = (process.env.APP_URL || process.env.NEXTAUTH_URL || getAppUrl()).trim()
      facebookBaseUrl = facebookBaseUrl.replace(/^["']|["']$/g, '')
      facebookBaseUrl = facebookBaseUrl.replace(/\/$/, '')
      
      // Force HTTPS for production
      const nodeEnv = process.env.NODE_ENV || 'development'
      if (nodeEnv === 'production') {
        if (facebookBaseUrl.startsWith('http://')) {
          facebookBaseUrl = facebookBaseUrl.replace('http://', 'https://')
        }
        if (facebookBaseUrl.includes('localhost') || facebookBaseUrl.includes(':4002') || facebookBaseUrl.includes('srv512766.hstgr.cloud')) {
          facebookBaseUrl = 'https://support.shopperskart.shop'
        }
      }
      
      // Use /privacy as the redirect URI (this is what Facebook accepts)
      const redirectUri = `${facebookBaseUrl}/privacy`

      if (!appId || !appSecret) {
        return NextResponse.redirect(
          `${getAppUrl()}/admin/integrations?error=config_missing`
        )
      }

      // Exchange code for access token
      const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
      
      const tokenResponse = await fetch(tokenUrl, { method: 'GET' })

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json()
        if (errorData.error?.message?.includes('client secret')) {
          return NextResponse.redirect(
            `${getAppUrl()}/admin/integrations?error=invalid_secret`
          )
        }
        return NextResponse.redirect(
          `${getAppUrl()}/admin/integrations?error=token_exchange_failed`
        )
      }

      const tokenData = await tokenResponse.json()
      const accessToken = tokenData.access_token

      // Get user's pages
      const pagesResponse = await fetch(
        `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`,
        { method: 'GET' }
      )

      if (!pagesResponse.ok) {
        return NextResponse.redirect(
          `${getAppUrl()}/admin/integrations?error=pages_fetch_failed`
        )
      }

      const pagesData = await pagesResponse.json()
      const pages = pagesData.data || []

      if (pages.length === 0) {
        return NextResponse.redirect(
          `${getAppUrl()}/admin/integrations?error=no_pages`
        )
      }

      // Save each page as an integration
      for (const page of pages as any[]) {
        const webhookToken = tenantId 
          ? (await getSystemSetting('FACEBOOK_WEBHOOK_VERIFY_TOKEN', tenantId) || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'facebook_2026')
          : (process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'facebook_2026')

        if (!tenantId) {
          return NextResponse.redirect(
            `${getAppUrl()}/admin/integrations?error=tenant_id_required`
          )
        }

        await prisma.facebookIntegration.upsert({
          where: { 
            tenantId_pageId: {
              tenantId,
              pageId: page.id,
            }
          },
          update: {
            pageName: page.name,
            accessToken: page.access_token,
            webhookToken,
            isActive: true,
            updatedAt: new Date(),
          },
          create: {
            id: crypto.randomUUID(),
            tenantId,
            pageId: page.id,
            pageName: page.name,
            accessToken: page.access_token,
            webhookToken,
            isActive: true,
            updatedAt: new Date(),
          },
        })

        // Subscribe to webhooks
        try {
          const subscribeUrl = `https://graph.facebook.com/v18.0/${page.id}/subscribed_apps?subscribed_fields=feed,messages,mention&access_token=${page.access_token}`
          const subscribeResponse = await fetch(subscribeUrl, { method: 'POST' })
          if (subscribeResponse.ok) {
            console.log(`[Facebook OAuth] ✅ Successfully subscribed page ${page.id}`)
          }
        } catch (subscribeError: any) {
          console.warn(`[Facebook OAuth] ⚠️ Error subscribing page ${page.id}:`, subscribeError.message)
        }
      }

      return NextResponse.redirect(
        `${getAppUrl()}/admin/integrations?success=connected`
      )
    }
    
    // If neither webhook verification nor OAuth callback, return 404
    return new NextResponse(null, { status: 404 })
  } catch (error: any) {
    console.error('[Privacy Handler] Error:', error)
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    )
  }
}

// Handle POST requests for webhook events - forward directly to facebook-service
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const FACEBOOK_SERVICE_URL = process.env.FACEBOOK_SERVICE_URL || 'http://localhost:4006'
    const webhookUrl = `${FACEBOOK_SERVICE_URL}/webhooks/facebook`

    const headers: HeadersInit = {
      'Content-Type': req.headers.get('content-type') || 'application/json',
    }

    // Forward the signature header (critical for webhook validation)
    const signature = req.headers.get('x-hub-signature-256')
    if (signature) {
      headers['x-hub-signature-256'] = signature
    }

    console.log('[Privacy Handler] Forwarding webhook POST to:', webhookUrl)

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body,
    })

    const responseText = await response.text()

    return new NextResponse(responseText, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    })
  } catch (error: any) {
    console.error('[Privacy Handler] Error forwarding webhook POST:', error.message)
    // Return 200 so Facebook doesn't keep retrying
    return NextResponse.json({ success: false }, { status: 200 })
  }
}
