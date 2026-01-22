import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAppUrl } from '@/lib/utils'
import { getSystemSetting } from '@/lib/system-settings'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Handle GET requests: webhook verification, OAuth callbacks, or normal page
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    
    // Check if this is a Facebook webhook verification request
    const hubMode = searchParams.get('hub.mode')
    const hubToken = searchParams.get('hub.verify_token')
    const hubChallenge = searchParams.get('hub.challenge')
    
    if (hubMode === 'subscribe') {
      // Webhook verification - must respond from this URL
      let verifyTokens: string[] = []
      
      if (process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
        verifyTokens.push(process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN)
      }
      
      verifyTokens.push('fb_verify_2025')
      verifyTokens.push('facebook_2026')
      
      try {
        const settings = await prisma.systemSettings.findMany({
          where: { key: 'FACEBOOK_WEBHOOK_VERIFY_TOKEN' },
        })
        
        if (settings.length > 0) {
          settings.forEach(setting => {
            if (setting.value && !verifyTokens.includes(setting.value)) {
              verifyTokens.push(setting.value)
            }
          })
        }
      } catch (error: any) {
        console.warn('[Privacy Route] Could not fetch verify token:', error.message)
      }
      
      verifyTokens = Array.from(new Set(verifyTokens.filter(Boolean)))
      
      if (hubToken && verifyTokens.includes(hubToken)) {
        return new NextResponse(hubChallenge || '', {
          status: 200,
          headers: {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
        })
      } else {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }
    
    // Check if this is an OAuth callback
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    
    if (code || error) {
      // Log the incoming request for debugging
      console.log('[Privacy Route] OAuth callback received:', {
        url: req.url,
        host: req.headers.get('host'),
        code: code ? 'present' : 'missing',
        state: state || 'missing',
        error: error || 'none',
      })
      
      // Handle OAuth callback directly here (no redirect needed)
      if (error) {
        // Use current request's origin for redirect
        const url = new URL(req.url)
        const baseUrl = `${url.protocol}//${url.host}`
        return NextResponse.redirect(
          `${baseUrl}/admin/integrations?error=${encodeURIComponent(error)}`
        )
      }

      if (!code) {
        const url = new URL(req.url)
        const baseUrl = `${url.protocol}//${url.host}`
        return NextResponse.redirect(
          `${baseUrl}/admin/integrations?error=no_code`
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
      
      // For Facebook OAuth, use the current request's origin
      const url = new URL(req.url)
      let facebookBaseUrl = `${url.protocol}//${url.host}`
      
      // Force HTTPS for production
      const nodeEnv = process.env.NODE_ENV || 'development'
      if (nodeEnv === 'production') {
        if (facebookBaseUrl.startsWith('http://')) {
          facebookBaseUrl = facebookBaseUrl.replace('http://', 'https://')
        }
      }
      
      // Use /privacy as the redirect URI (this is what Facebook accepts)
      const redirectUri = `${facebookBaseUrl}/privacy`

      if (!appId || !appSecret) {
        const baseUrl = `${url.protocol}//${url.host}`
        return NextResponse.redirect(
          `${baseUrl}/admin/integrations?error=config_missing`
        )
      }

      // Exchange code for access token
      const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
      
      const tokenResponse = await fetch(tokenUrl, { method: 'GET' })

      if (!tokenResponse.ok) {
        const errorData = await tokenResponse.json()
        const baseUrl = `${url.protocol}//${url.host}`
        if (errorData.error?.message?.includes('client secret')) {
          return NextResponse.redirect(
            `${baseUrl}/admin/integrations?error=invalid_secret`
          )
        }
        return NextResponse.redirect(
          `${baseUrl}/admin/integrations?error=token_exchange_failed`
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
        const baseUrl = `${url.protocol}//${url.host}`
        return NextResponse.redirect(
          `${baseUrl}/admin/integrations?error=pages_fetch_failed`
        )
      }

      const pagesData = await pagesResponse.json()
      const pages = pagesData.data || []

      if (pages.length === 0) {
        const baseUrl = `${url.protocol}//${url.host}`
        return NextResponse.redirect(
          `${baseUrl}/admin/integrations?error=no_pages`
        )
      }

      // Save each page as an integration
      for (const page of pages) {
        const webhookToken = tenantId 
          ? (await getSystemSetting('FACEBOOK_WEBHOOK_VERIFY_TOKEN', tenantId) || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'facebook_2026')
          : (process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'facebook_2026')

        if (!tenantId) {
          const baseUrl = `${url.protocol}//${url.host}`
          return NextResponse.redirect(
            `${baseUrl}/admin/integrations?error=tenant_id_required`
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

      const baseUrl = `${url.protocol}//${url.host}`
      return NextResponse.redirect(
        `${baseUrl}/admin/integrations?success=connected`
      )
    }
    
    // Normal page visit - return 404 to let Next.js handle it
    // Actually, since we have route.ts, page.tsx won't be called
    // So we need to redirect to a different path or return the page content
    // Let's redirect to /privacy-policy for normal visits
    return NextResponse.redirect(new URL('/privacy-policy', req.url))
  } catch (error: any) {
    console.error('[Privacy Route] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Handle POST requests for webhook events
export async function POST(req: NextRequest) {
  try {
    const body = await req.text()
    const headers: HeadersInit = {}
    
    req.headers.forEach((value, key) => {
      if (key.toLowerCase() !== 'host') {
        headers[key] = value
      }
    })
    
    const host = req.headers.get('host') || ''
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http'
    const webhookUrl = `${protocol}://${host}/webhooks/facebook`
    
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
    console.error('[Privacy Route] Error forwarding webhook POST:', error)
    return NextResponse.json({ error: 'Failed to process webhook' }, { status: 500 })
  }
}
