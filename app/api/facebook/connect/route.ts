import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAppUrl } from '@/lib/utils'
import { getSystemSetting } from '@/lib/system-settings'

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

    // Get Facebook configuration from SystemSettings (with fallback to environment variables)
    const appId = (await getSystemSetting('FACEBOOK_APP_ID', tenantId) || process.env.FACEBOOK_APP_ID)?.trim()
    // For Facebook OAuth, use APP_URL/NEXTAUTH_URL if set (for ngrok), otherwise use getAppUrl()
    // Remove quotes if present (some .env files have quotes)
    let facebookBaseUrl = (process.env.APP_URL || process.env.NEXTAUTH_URL || getAppUrl()).trim()
    facebookBaseUrl = facebookBaseUrl.replace(/^["']|["']$/g, '') // Remove surrounding quotes
    facebookBaseUrl = facebookBaseUrl.replace(/\/$/, '') // Remove trailing slash
    const redirectUri = `${facebookBaseUrl}/api/facebook/callback`
    // Extract domain for App Domains field (without protocol and path)
    const appDomain = facebookBaseUrl.replace(/^https?:\/\//, '').split('/')[0]
    
    // Detailed debugging
    console.log('[Facebook Connect] Environment Check:', {
      rawAppId: process.env.FACEBOOK_APP_ID ? 'SET' : 'NOT SET',
      appIdLength: appId?.length || 0,
      appIdValue: appId ? `${appId.substring(0, 4)}...${appId.substring(appId.length - 4)}` : 'EMPTY',
      appIdType: typeof appId,
      hasWhitespace: appId ? /\s/.test(appId) : false,
      redirectUri,
      nodeEnv: process.env.NODE_ENV,
      appUrl: process.env.APP_URL || 'NOT SET',
      nextAuthUrl: process.env.NEXTAUTH_URL || 'NOT SET',
      facebookBaseUrl,
      expectedRedirectUri: 'https://illusively-crippling-marvel.ngrok-free.dev/api/facebook/callback',
    })
    
    // Validate App ID
    if (!appId) {
      console.error('[Facebook Connect] ❌ FACEBOOK_APP_ID is not set in environment variables')
      return NextResponse.json(
        { error: 'Facebook App ID not configured. Please set FACEBOOK_APP_ID in environment variables.' },
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
    
    // Log full redirect URI for debugging
    const expectedRedirectUri = 'https://illusively-crippling-marvel.ngrok-free.dev/api/facebook/callback'
    const redirectUriMatches = redirectUri === expectedRedirectUri
    
    console.log('[Facebook Connect] 📋 IMPORTANT - Facebook Configuration:', {
      fullRedirectUri: redirectUri,
      expectedInFacebook: expectedRedirectUri,
      matches: redirectUriMatches ? '✅ YES' : '❌ NO',
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
        `  5. Add domain: ${facebookBaseUrl.replace(/^https?:\/\//, '').split('/')[0]}`,
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
        redirectUriMatches 
          ? '✅ Redirect URI matches expected ngrok URL!' 
          : '⚠️  WARNING: Redirect URI does NOT match expected ngrok URL!',
      ],
    })
    
    if (!redirectUriMatches) {
      console.error('[Facebook Connect] ❌ CRITICAL: Redirect URI mismatch!')
      console.error('[Facebook Connect] Current:', redirectUri)
      console.error('[Facebook Connect] Expected:', expectedRedirectUri)
      console.error('[Facebook Connect] 💡 Fix: Make sure APP_URL=https://illusively-crippling-marvel.ngrok-free.dev in .env (without quotes)')
    }

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

