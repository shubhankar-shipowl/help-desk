import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSystemSetting, clearSystemSettingsCache } from '@/lib/system-settings'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Handle Facebook OAuth callback
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    
    // Get OAuth callback parameters
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')
    const errorReason = searchParams.get('error_reason')
    const errorDescription = searchParams.get('error_description')
    
    console.log('[Facebook OAuth Callback] ========================================')
    console.log('[Facebook OAuth Callback] 📥 Incoming OAuth callback')
    console.log('[Facebook OAuth Callback] URL:', req.url)
    console.log('[Facebook OAuth Callback] Code:', code ? 'present' : 'missing')
    console.log('[Facebook OAuth Callback] State:', state || 'missing')
    console.log('[Facebook OAuth Callback] Error:', error || 'none')
    if (error) {
      console.log('[Facebook OAuth Callback] Error Reason:', errorReason || 'none')
      console.log('[Facebook OAuth Callback] Error Description:', errorDescription || 'none')
    }
    console.log('[Facebook OAuth Callback] ========================================')
    
    // Simple test: If no code parameter, return success message to verify route works
    if (!code && !error) {
      return new NextResponse('Facebook callback working', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain',
        },
      })
    }
    
    // Handle OAuth errors
    if (error) {
      const baseUrl = 'https://support.shopperskart.shop'
      const errorMessage = errorDescription || errorReason || error
      console.error('[Facebook OAuth Callback] ❌ OAuth error:', errorMessage)
      return NextResponse.redirect(
        `${baseUrl}/admin/integrations?error=${encodeURIComponent(errorMessage)}`
      )
    }
    
    // Validate required parameters
    if (!code) {
      const baseUrl = 'https://support.shopperskart.shop'
      console.error('[Facebook OAuth Callback] ❌ Missing authorization code')
      return NextResponse.redirect(
        `${baseUrl}/admin/integrations?error=no_code`
      )
    }
    
    if (!state) {
      const baseUrl = 'https://support.shopperskart.shop'
      console.error('[Facebook OAuth Callback] ❌ Missing state parameter')
      return NextResponse.redirect(
        `${baseUrl}/admin/integrations?error=no_state`
      )
    }
    
    // Get tenantId from state (user ID) - we stored it in the OAuth state
    let tenantId: string | null = null
    const user = await prisma.user.findUnique({
      where: { id: state },
      select: { tenantId: true },
    })
    tenantId = user?.tenantId || null
    
    if (!tenantId) {
      const baseUrl = 'https://support.shopperskart.shop'
      console.error('[Facebook OAuth Callback] ❌ Could not find tenant ID from user state')
      return NextResponse.redirect(
        `${baseUrl}/admin/integrations?error=tenant_not_found`
      )
    }
    
    console.log('[Facebook OAuth Callback] ✅ Found tenant ID:', tenantId)
    
    // Clear cache first to ensure we get fresh data
    if (tenantId) {
      clearSystemSettingsCache(tenantId, null)
      console.log('[Facebook OAuth Callback] Cleared cache for tenant:', tenantId)
    }
    
    // Get Facebook configuration from SystemSettings (with fallback to environment variables)
    let systemSettingAppId = tenantId 
      ? await getSystemSetting('FACEBOOK_APP_ID', tenantId, null)
      : null
    let systemSettingAppSecret = tenantId
      ? await getSystemSetting('FACEBOOK_APP_SECRET', tenantId, null)
      : null
    
    // If not found, try direct database query as fallback
    if (!systemSettingAppId && tenantId) {
      console.log('[Facebook OAuth Callback] System setting not found, trying direct database query...')
      const directSettings = await prisma.systemSettings.findMany({
        where: {
          tenantId,
          key: {
            in: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
          },
        },
        orderBy: [
          { storeId: 'desc' }, // Prefer store-specific, then tenant-level
        ],
      })
      
      const settingsMap: Record<string, string> = {}
      directSettings.forEach((s) => {
        if (!settingsMap[s.key]) {
          settingsMap[s.key] = s.value
        }
      })
      
      if (settingsMap.FACEBOOK_APP_ID) {
        systemSettingAppId = settingsMap.FACEBOOK_APP_ID
        console.log('[Facebook OAuth Callback] Found App ID via direct database query')
      }
      if (settingsMap.FACEBOOK_APP_SECRET) {
        systemSettingAppSecret = settingsMap.FACEBOOK_APP_SECRET
        console.log('[Facebook OAuth Callback] Found App Secret via direct database query')
      }
    }
    
    const appId = (systemSettingAppId || process.env.FACEBOOK_APP_ID)?.trim()
    const appSecret = (systemSettingAppSecret || process.env.FACEBOOK_APP_SECRET)?.trim()
    
    // Detailed logging for debugging
    console.log('[Facebook OAuth Callback] Configuration Check:', {
      tenantId,
      systemSettingAppId: systemSettingAppId ? `${systemSettingAppId.substring(0, 4)}...${systemSettingAppId.substring(systemSettingAppId.length - 4)}` : 'NOT SET',
      systemSettingAppSecret: systemSettingAppSecret ? 'SET (hidden)' : 'NOT SET',
      envAppId: process.env.FACEBOOK_APP_ID ? 'SET' : 'NOT SET',
      envAppSecret: process.env.FACEBOOK_APP_SECRET ? 'SET' : 'NOT SET',
      finalAppId: appId ? `${appId.substring(0, 4)}...${appId.substring(appId.length - 4)}` : 'EMPTY',
      finalAppSecret: appSecret ? 'SET (hidden)' : 'EMPTY',
    })
    
    if (!appId || !appSecret) {
      // Always use production domain for Facebook OAuth callback redirects
      const baseUrl = 'https://support.shopperskart.shop'
      console.error('[Facebook OAuth Callback] ❌ Missing Facebook configuration')
      console.error('[Facebook OAuth Callback] App ID:', appId ? 'present' : 'missing')
      console.error('[Facebook OAuth Callback] App Secret:', appSecret ? 'present' : 'missing')
      console.error('[Facebook OAuth Callback] System Setting App ID:', systemSettingAppId ? 'found' : 'not found')
      console.error('[Facebook OAuth Callback] System Setting App Secret:', systemSettingAppSecret ? 'found' : 'not found')
      return NextResponse.redirect(
        `${baseUrl}/admin/integrations?error=config_missing`
      )
    }
    
    // For Facebook OAuth, always use support.shopperskart.shop for redirect URI
    // This ensures it matches what's configured in Facebook Developer Console
    const facebookBaseUrl = 'https://support.shopperskart.shop'
    const redirectUri = `${facebookBaseUrl}/auth/facebook/callback`
    
    console.log('[Facebook OAuth Callback] 🔄 Exchanging code for access token...')
    console.log('[Facebook OAuth Callback] Redirect URI:', redirectUri)
    
    // Exchange code for access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
    
    const tokenResponse = await fetch(tokenUrl, { method: 'GET' })
    
    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json().catch(() => ({}))
      const baseUrl = 'https://support.shopperskart.shop'
      console.error('[Facebook OAuth Callback] ❌ Token exchange failed:', errorData)
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
    
    if (!accessToken) {
      const baseUrl = 'https://support.shopperskart.shop'
      console.error('[Facebook OAuth Callback] ❌ No access token in response')
      return NextResponse.redirect(
        `${baseUrl}/admin/integrations?error=no_access_token`
      )
    }
    
    console.log('[Facebook OAuth Callback] ✅ Access token received')
    console.log('[Facebook OAuth Callback] 📋 Fetching user pages...')
    
    // Get user's pages
    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`,
      { method: 'GET' }
    )
    
    if (!pagesResponse.ok) {
      const baseUrl = 'https://support.shopperskart.shop'
      const errorData = await pagesResponse.json().catch(() => ({}))
      console.error('[Facebook OAuth Callback] ❌ Failed to fetch pages:', errorData)
      return NextResponse.redirect(
        `${baseUrl}/admin/integrations?error=pages_fetch_failed`
      )
    }
    
    const pagesData = await pagesResponse.json()
    const pages = pagesData.data || []
    
    if (pages.length === 0) {
      const baseUrl = 'https://support.shopperskart.shop'
      console.warn('[Facebook OAuth Callback] ⚠️ No pages found for user')
      return NextResponse.redirect(
        `${baseUrl}/admin/integrations?error=no_pages`
      )
    }
    
    console.log('[Facebook OAuth Callback] ✅ Found', pages.length, 'page(s)')
    
    // Get webhook token
    const webhookToken = tenantId 
      ? (await getSystemSetting('FACEBOOK_WEBHOOK_VERIFY_TOKEN', tenantId) || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'facebook_2026')
      : (process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'facebook_2026')
    
    // Save each page as an integration
    for (const page of pages) {
      console.log('[Facebook OAuth Callback] 💾 Saving integration for page:', page.id, page.name)
      
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
          console.log(`[Facebook OAuth Callback] ✅ Successfully subscribed page ${page.id} to webhooks`)
        } else {
          const errorData = await subscribeResponse.json().catch(() => ({}))
          console.warn(`[Facebook OAuth Callback] ⚠️ Error subscribing page ${page.id}:`, errorData)
        }
      } catch (subscribeError: any) {
        console.warn(`[Facebook OAuth Callback] ⚠️ Error subscribing page ${page.id}:`, subscribeError.message)
      }
    }
    
    // Get the correct base URL from the incoming request
    // Since Facebook OAuth always redirects to the production URL (support.shopperskart.shop),
    // we should always redirect back to the production URL to maintain session consistency.
    // The user will need to login on the production site if they don't have a session there.
    const requestUrl = new URL(req.url)
    
    // Always use the production domain for Facebook OAuth callback redirects
    // This ensures the user stays on the same domain where Facebook redirected them
    const baseUrl = 'https://support.shopperskart.shop'
    
    console.log('[Facebook OAuth Callback] ✅ Successfully connected Facebook pages')
    console.log('[Facebook OAuth Callback] Request URL:', req.url)
    console.log('[Facebook OAuth Callback] Base URL:', baseUrl)
    console.log('[Facebook OAuth Callback] Redirecting to:', `${baseUrl}/admin/integrations?success=connected`)
    
    // Redirect directly to admin/integrations on production
    // The user will need to have a session on support.shopperskart.shop
    return NextResponse.redirect(
      `${baseUrl}/admin/integrations?success=connected`
    )
  } catch (error: any) {
    console.error('[Facebook OAuth Callback] ❌ Unexpected error:', error)
    
    // Always use production domain for Facebook OAuth callback redirects
    const baseUrl = 'https://support.shopperskart.shop'
    
    return NextResponse.redirect(
      `${baseUrl}/admin/integrations?error=${encodeURIComponent(error.message || 'unexpected_error')}`
    )
  }
}
