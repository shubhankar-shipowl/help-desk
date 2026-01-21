import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAppUrl } from '@/lib/utils'
import { getSystemSetting } from '@/lib/system-settings'
import { prisma } from '@/lib/prisma'

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

    // Get storeId from query parameter (optional, but needed for store-specific settings)
    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')

    // Get Facebook configuration from SystemSettings (with fallback to environment variables)
    // Try store-specific setting first, then tenant-level, then environment variable
    const systemSettingAppId = await getSystemSetting('FACEBOOK_APP_ID', tenantId, storeId || null)
    const envAppId = process.env.FACEBOOK_APP_ID
    const appId = (systemSettingAppId || envAppId)?.trim()
    
    // Debug logging
    console.log('[Facebook Connect] Configuration Check:', {
      tenantId,
      storeId: storeId || 'none (tenant-level)',
      systemSettingAppId: systemSettingAppId ? `${systemSettingAppId.substring(0, 4)}...${systemSettingAppId.substring(systemSettingAppId.length - 4)}` : 'NOT SET',
      envAppId: envAppId ? 'SET' : 'NOT SET',
      finalAppId: appId ? `${appId.substring(0, 4)}...${appId.substring(appId.length - 4)}` : 'EMPTY',
      appIdSource: systemSettingAppId ? (storeId ? 'SystemSettings (store-specific)' : 'SystemSettings (tenant-level)') : (envAppId ? 'Environment Variable' : 'NOT FOUND'),
    })
    
    // For Facebook OAuth, use APP_URL/NEXTAUTH_URL if set, otherwise use getAppUrl()
    // Remove quotes if present (some .env files have quotes)
    let facebookBaseUrl = (process.env.APP_URL || process.env.NEXTAUTH_URL || getAppUrl()).trim()
    facebookBaseUrl = facebookBaseUrl.replace(/^["']|["']$/g, '') // Remove surrounding quotes
    facebookBaseUrl = facebookBaseUrl.replace(/\/$/, '') // Remove trailing slash
    
    // CRITICAL: Force HTTPS for production and validate URL format
    // Facebook requires HTTPS for OAuth redirects (except localhost in development)
    const nodeEnv = process.env.NODE_ENV || 'development'
    if (nodeEnv === 'production') {
      // In production, always use HTTPS
      if (facebookBaseUrl.startsWith('http://')) {
        facebookBaseUrl = facebookBaseUrl.replace('http://', 'https://')
        console.warn('[Facebook Connect] ⚠️ Converted HTTP to HTTPS for production:', facebookBaseUrl)
      }
      // Ensure we're not using internal server URLs in production
      if (facebookBaseUrl.includes('localhost') || facebookBaseUrl.includes(':3002') || facebookBaseUrl.includes('srv512766.hstgr.cloud')) {
        console.error('[Facebook Connect] ❌ CRITICAL: Using internal server URL in production!')
        console.error('[Facebook Connect] Current URL:', facebookBaseUrl)
        console.error('[Facebook Connect] Expected: https://support.shopperskart.shop')
        // Override with correct production URL
        facebookBaseUrl = 'https://support.shopperskart.shop'
        console.warn('[Facebook Connect] ⚠️ Overriding with correct production URL:', facebookBaseUrl)
      }
    }
    
    // Use /privacy as redirect URI since Facebook only accepts that URL
    const redirectUri = `${facebookBaseUrl}/privacy`
    // Extract domain for App Domains field (without protocol and path)
    const appDomain = facebookBaseUrl.replace(/^https?:\/\//, '').split('/')[0]
    
    // Validate redirect URI format
    if (!redirectUri.startsWith('https://') && nodeEnv === 'production') {
      console.error('[Facebook Connect] ❌ CRITICAL: Redirect URI must use HTTPS in production!')
      console.error('[Facebook Connect] Current redirect URI:', redirectUri)
      return NextResponse.json(
        { 
          error: 'Invalid redirect URI configuration. Production requires HTTPS. Please set APP_URL=https://support.shopperskart.shop in your .env file.',
          currentRedirectUri: redirectUri,
          expectedRedirectUri: 'https://support.shopperskart.shop/api/facebook/callback',
        },
        { status: 500 }
      )
    }
    
    // Detailed debugging
    console.log('[Facebook Connect] Configuration Check:', {
      systemSettingAppId: systemSettingAppId ? `${systemSettingAppId.substring(0, 4)}...${systemSettingAppId.substring(systemSettingAppId.length - 4)}` : 'NOT SET',
      envAppId: envAppId ? 'SET' : 'NOT SET',
      finalAppId: appId ? `${appId.substring(0, 4)}...${appId.substring(appId.length - 4)}` : 'EMPTY',
      appIdSource: systemSettingAppId ? 'SystemSettings' : (envAppId ? 'Environment Variable' : 'NOT FOUND'),
      appIdLength: appId?.length || 0,
      appIdType: typeof appId,
      hasWhitespace: appId ? /\s/.test(appId) : false,
      redirectUri,
      nodeEnv: process.env.NODE_ENV,
      appUrl: process.env.APP_URL || 'NOT SET',
      nextAuthUrl: process.env.NEXTAUTH_URL || 'NOT SET',
      facebookBaseUrl,
      tenantId,
      redirectUriValid: redirectUri.startsWith('https://') || nodeEnv !== 'production',
    })
    
    // Validate App ID
    if (!appId) {
      console.error('[Facebook Connect] ❌ FACEBOOK_APP_ID is not configured')
      console.error('[Facebook Connect] Checked sources:', {
        systemSettings: systemSettingAppId ? 'Found' : 'Not found',
        environmentVariable: envAppId ? 'Found' : 'Not found',
        tenantId,
      })
      return NextResponse.json(
        { 
          error: 'Facebook App ID not configured. Please configure it in the admin panel (Facebook Configuration) or set FACEBOOK_APP_ID in environment variables.',
          hint: 'Go to Admin → Integrations → Facebook Configuration and enter your Facebook App ID.'
        },
        { status: 500 }
      )
    }
    
    // Validate App ID format (should be numeric, typically 15-16 digits)
    // Facebook App IDs can be 15-16 digits, but sometimes they can be longer
    const trimmedAppId = appId.trim()
    if (!/^\d{15,20}$/.test(trimmedAppId)) {
      console.error('[Facebook Connect] ❌ Invalid App ID format:', {
        value: trimmedAppId.substring(0, 10) + '...',
        length: trimmedAppId.length,
        isNumeric: /^\d+$/.test(trimmedAppId),
        hasSpaces: /\s/.test(trimmedAppId),
        hasSpecialChars: /[^0-9]/.test(trimmedAppId),
      })
      return NextResponse.json(
        { error: `Invalid Facebook App ID format. App ID should be 15-20 digits (numeric only). Current length: ${trimmedAppId.length}, Value: ${trimmedAppId.substring(0, 10)}...` },
        { status: 500 }
      )
    }
    
    console.log('[Facebook Connect] ✅ Configuration Valid:', {
      hasAppId: !!appId,
      appIdLength: trimmedAppId.length,
      appIdPrefix: trimmedAppId.substring(0, 4) + '...',
      redirectUri,
    })

    // Facebook OAuth scopes needed (valid permissions)
    // Using minimal required permissions that work without App Review
    const scopes = [
      'pages_show_list',       // List pages user manages (basic, no review needed)
      'pages_manage_metadata', // Manage page metadata (basic, no review needed)
      'pages_messaging',       // Send/receive messages (may require App Review for production)
    ].join(',')

    // Generate Facebook OAuth URL (using trimmedAppId already defined above)
    const facebookAuthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${trimmedAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${session.user.id}`

    // Log full OAuth URL for debugging (first 150 chars)
    console.log('[Facebook Connect] 🔗 Full OAuth URL:', facebookAuthUrl.substring(0, 150) + '...')
    
    console.log('[Facebook Connect] 🔗 Generated OAuth URL:', {
      url: facebookAuthUrl.substring(0, 100) + '...',
      clientId: trimmedAppId,
      clientIdLength: trimmedAppId.length,
      redirectUri,
      redirectUriEncoded: encodeURIComponent(redirectUri),
      scopes,
      state: session.user.id,
    })
    
    console.log('[Facebook Connect] 📋 IMPORTANT - Facebook Configuration:', {
      fullRedirectUri: redirectUri,
      appUrl: process.env.APP_URL || 'NOT SET',
      nextAuthUrl: process.env.NEXTAUTH_URL || 'NOT SET',
      facebookBaseUrl,
      appDomain,
      note: 'Two separate configurations needed in Facebook Developer Console',
      troubleshooting: [
        '📍 CRITICAL: Two separate configurations needed in Facebook Developer Console:',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '1️⃣  APP DOMAINS (Settings → Basic)',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '  1. Go to: https://developers.facebook.com/apps',
        '  2. Select your app',
        '  3. Go to Settings → Basic',
        '  4. Find "App Domains" field',
        `  5. Add domain: ${appDomain}`,
        '     (Just the domain, no https:// or paths)',
        '  6. Click "Save Changes"',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '2️⃣  OAUTH REDIRECT URI (Products → Facebook Login → Settings)',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        '  1. Go to Products → Facebook Login',
        '  2. Click "Settings" tab',
        '  3. Find "Valid OAuth Redirect URIs"',
        `  4. Add EXACT URL: ${redirectUri}`,
        '  5. Click "Save Changes"',
        '',
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
        `✅ Current redirect URI: ${redirectUri}`,
        `✅ Current app domain: ${appDomain}`,
        '',
        '💡 Make sure these match what you configured in Facebook Developer Console!',
      ],
    })

    // Validate App ID format one more time before sending
    if (!/^\d{15,20}$/.test(trimmedAppId)) {
      console.error('[Facebook Connect] ❌ CRITICAL: App ID format invalid before OAuth:', {
        appId: trimmedAppId,
        length: trimmedAppId.length,
        isNumeric: /^\d+$/.test(trimmedAppId),
      })
      return NextResponse.json({
        error: `Invalid App ID format. Expected 15-20 digits, got ${trimmedAppId.length} characters.`,
        appIdPrefix: trimmedAppId.substring(0, 4) + '...',
      }, { status: 500 })
    }

    return NextResponse.json({ 
      authUrl: facebookAuthUrl,
      redirectUri, // Include in response for debugging
      debug: {
        appIdLength: trimmedAppId.length,
        appIdPrefix: trimmedAppId.substring(0, 4) + '...',
        redirectUri,
        nodeEnv: process.env.NODE_ENV,
      },
    })
  } catch (error: any) {
    console.error('Error generating Facebook OAuth URL:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate Facebook OAuth URL' },
      { status: 500 }
    )
  }
}

