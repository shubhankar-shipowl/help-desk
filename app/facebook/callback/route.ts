import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getAppUrl } from '@/lib/utils'
import { getSystemSetting } from '@/lib/system-settings'
import crypto from 'crypto'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const code = searchParams.get('code')
    const state = searchParams.get('state')
    const error = searchParams.get('error')

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
    // Remove quotes if present (some .env files have quotes)
    let facebookBaseUrl = (process.env.APP_URL || process.env.NEXTAUTH_URL || getAppUrl()).trim()
    facebookBaseUrl = facebookBaseUrl.replace(/^["']|["']$/g, '') // Remove surrounding quotes
    facebookBaseUrl = facebookBaseUrl.replace(/\/$/, '') // Remove trailing slash
    
    // Force HTTPS for production
    const nodeEnv = process.env.NODE_ENV || 'development'
    if (nodeEnv === 'production') {
      if (facebookBaseUrl.startsWith('http://')) {
        facebookBaseUrl = facebookBaseUrl.replace('http://', 'https://')
      }
      if (facebookBaseUrl.includes('localhost') || facebookBaseUrl.includes(':3002') || facebookBaseUrl.includes('srv512766.hstgr.cloud')) {
        facebookBaseUrl = 'https://support.shopperskart.shop'
      }
    }
    
    const redirectUri = `${facebookBaseUrl}/facebook/callback`

    // Debug logging
    console.log('Facebook OAuth Configuration Check:', {
      hasAppId: !!appId,
      hasAppSecret: !!appSecret,
      appIdLength: appId?.length || 0,
      appSecretLength: appSecret?.length || 0,
      redirectUri,
    })

    if (!appId || !appSecret) {
      console.error('Facebook OAuth configuration missing:', {
        hasAppId: !!appId,
        hasAppSecret: !!appSecret,
      })
      return NextResponse.redirect(
        `${getAppUrl()}/admin/integrations?error=config_missing`
      )
    }

    // Exchange code for access token
    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`
    
    console.log('Exchanging code for access token...', {
      hasCode: !!code,
      redirectUri,
      appId: appId?.substring(0, 4) + '...',
    })

    const tokenResponse = await fetch(tokenUrl, { method: 'GET' })

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json()
      console.error('Facebook token exchange error:', errorData)
      
      if (errorData.error?.message?.includes('client secret')) {
        console.error('Invalid Facebook App Secret. Please check FACEBOOK_APP_SECRET in .env file.')
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
      const errorData = await pagesResponse.json()
      console.error('Facebook pages fetch error:', errorData)
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

    // Save each page as an integration and subscribe to feed
    for (const page of pages) {
      // Get webhook token
      const webhookToken = tenantId 
        ? (await getSystemSetting('FACEBOOK_WEBHOOK_VERIFY_TOKEN', tenantId) || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'fb_verify_2025')
        : (process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'fb_verify_2025')

      // Ensure tenantId is available (required for multi-tenancy)
      if (!tenantId) {
        console.error('[Facebook Callback] Tenant ID is required but not found')
        return NextResponse.redirect(
          `${getAppUrl()}/admin/integrations?error=tenant_id_required`
        )
      }

      // Save integration using compound unique key (tenantId + pageId)
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

      // Automatically subscribe to feed and messages fields
      try {
        console.log(`[Facebook Callback] Attempting to subscribe page ${page.id} to feed, messages, and mention...`)
        const subscribeUrl = `https://graph.facebook.com/v18.0/${page.id}/subscribed_apps?subscribed_fields=feed,messages,mention&access_token=${page.access_token}`
        
        const subscribeResponse = await fetch(subscribeUrl, {
          method: 'POST',
        })

        if (subscribeResponse.ok) {
          const subscribeData = await subscribeResponse.json()
          console.log(`[Facebook Callback] ✅ Successfully subscribed page ${page.id} to feed, messages, and mention:`, subscribeData)
        } else {
          const errorData = await subscribeResponse.json().catch(() => ({}))
          console.warn(`[Facebook Callback] ⚠️ Could not auto-subscribe page ${page.id} to feed/messages/mention:`, errorData)
        }
      } catch (subscribeError: any) {
        console.warn(`[Facebook Callback] ⚠️ Error attempting to subscribe page ${page.id} to feed:`, subscribeError.message)
      }
    }

    return NextResponse.redirect(
      `${getAppUrl()}/admin/integrations?success=connected`
    )
  } catch (error: any) {
    console.error('Error in Facebook callback:', error)
    return NextResponse.redirect(
      `${getAppUrl()}/admin/integrations?error=${encodeURIComponent(error.message || 'unknown_error')}`
    )
  }
}
