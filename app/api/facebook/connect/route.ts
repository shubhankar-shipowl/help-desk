import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAppUrl } from '@/lib/utils'
import { getSystemSetting, clearSystemSettingsCache } from '@/lib/system-settings'
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

    // Clear cache first to ensure we get fresh data
    clearSystemSettingsCache(tenantId, storeId || null)
    console.log('[Facebook Connect] Cleared cache for tenant:', tenantId, 'store:', storeId || 'tenant-level')

    // Get Facebook configuration from SystemSettings (with fallback to environment variables)
    // Try store-specific setting first, then tenant-level, then environment variable
    let systemSettingAppId = await getSystemSetting('FACEBOOK_APP_ID', tenantId, storeId || null)
    let systemSettingAppSecret = await getSystemSetting('FACEBOOK_APP_SECRET', tenantId, storeId || null)
    
    // If not found with storeId, try tenant-level (storeId = null)
    if (!systemSettingAppId && storeId) {
      console.log('[Facebook Connect] Store-specific setting not found, trying tenant-level...')
      systemSettingAppId = await getSystemSetting('FACEBOOK_APP_ID', tenantId, null)
      systemSettingAppSecret = await getSystemSetting('FACEBOOK_APP_SECRET', tenantId, null)
    }
    
    // If still not found, try direct database query as fallback
    if (!systemSettingAppId) {
      console.log('[Facebook Connect] System setting not found, trying direct database query...')
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
        console.log('[Facebook Connect] Found App ID via direct database query')
      }
      if (settingsMap.FACEBOOK_APP_SECRET) {
        systemSettingAppSecret = settingsMap.FACEBOOK_APP_SECRET
        console.log('[Facebook Connect] Found App Secret via direct database query')
      }
    }
    
    const envAppId = process.env.FACEBOOK_APP_ID
    const envAppSecret = process.env.FACEBOOK_APP_SECRET
    const appId = (systemSettingAppId || envAppId)?.trim()
    const appSecret = (systemSettingAppSecret || envAppSecret)?.trim()
    
    // Debug logging
    console.log('[Facebook Connect] ========================================')
    console.log('[Facebook Connect] Configuration Check:')
    console.log('[Facebook Connect]   Tenant ID:', tenantId)
    console.log('[Facebook Connect]   Store ID:', storeId || 'none (tenant-level)')
    console.log('[Facebook Connect]   System Setting App ID:', systemSettingAppId ? `${systemSettingAppId.substring(0, 4)}...${systemSettingAppId.substring(systemSettingAppId.length - 4)}` : 'NOT SET')
    console.log('[Facebook Connect]   System Setting App Secret:', systemSettingAppSecret ? 'SET (hidden)' : 'NOT SET')
    console.log('[Facebook Connect]   Environment App ID:', envAppId ? 'SET' : 'NOT SET')
    console.log('[Facebook Connect]   Environment App Secret:', envAppSecret ? 'SET' : 'NOT SET')
    console.log('[Facebook Connect]   Final App ID:', appId ? `${appId.substring(0, 4)}...${appId.substring(appId.length - 4)}` : 'EMPTY')
    console.log('[Facebook Connect]   Final App Secret:', appSecret ? 'SET (hidden)' : 'EMPTY')
    console.log('[Facebook Connect]   App ID Source:', systemSettingAppId ? (storeId ? 'SystemSettings (store-specific)' : 'SystemSettings (tenant-level)') : (envAppId ? 'Environment Variable' : 'NOT FOUND'))
    console.log('[Facebook Connect] ========================================')
    
    // CRITICAL: ALWAYS use https://support.shopperskart.shop for Facebook OAuth
    // This is the ONLY URL that Facebook accepts as a Valid OAuth Redirect URI
    // We must use this exact URL regardless of environment or other settings
    const facebookBaseUrl = 'https://support.shopperskart.shop'
    console.log('[Facebook Connect] Using Facebook OAuth URL:', facebookBaseUrl)
    
    // Use /auth/facebook/callback as redirect URI for OAuth
    const redirectUri = `${facebookBaseUrl}/auth/facebook/callback`
    // Extract domain for App Domains field (without protocol and path)
    const appDomain = facebookBaseUrl.replace(/^https?:\/\//, '').split('/')[0]
    
    // Validate redirect URI format (should always be HTTPS for Facebook)
    if (!redirectUri.startsWith('https://')) {
      console.error('[Facebook Connect] ❌ CRITICAL: Redirect URI must use HTTPS!')
      console.error('[Facebook Connect] Current redirect URI:', redirectUri)
      return NextResponse.json(
        { 
          error: 'Invalid redirect URI configuration. Facebook requires HTTPS.',
          currentRedirectUri: redirectUri,
          expectedRedirectUri: 'https://support.shopperskart.shop/auth/facebook/callback',
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
      redirectUriValid: redirectUri.startsWith('https://'),
    })
    
    // Validate App ID and App Secret
    if (!appId || !appSecret) {
      console.error('[Facebook Connect] ❌ Facebook configuration is incomplete')
      console.error('[Facebook Connect] Missing:', {
        appId: !appId ? 'YES' : 'NO',
        appSecret: !appSecret ? 'YES' : 'NO',
      })
      console.error('[Facebook Connect] Checked sources:', {
        systemSettingsAppId: systemSettingAppId ? 'Found' : 'Not found',
        systemSettingsAppSecret: systemSettingAppSecret ? 'Found' : 'Not found',
        environmentAppId: envAppId ? 'Found' : 'Not found',
        environmentAppSecret: envAppSecret ? 'Found' : 'Not found',
        tenantId,
        storeId: storeId || 'tenant-level',
      })
      
      // Provide helpful error message
      let errorMessage = 'Facebook App ID or App Secret is not configured. '
      if (!systemSettingAppId && !envAppId) {
        errorMessage += 'Please configure it in Admin → Settings → Facebook Configuration and save the settings.'
      } else if (!systemSettingAppSecret && !envAppSecret) {
        errorMessage += 'App Secret is missing. Please add it in Admin → Settings → Facebook Configuration.'
      } else {
        errorMessage += 'Please check your configuration in Admin → Settings → Facebook Configuration.'
      }
      
      return NextResponse.json(
        { 
          error: errorMessage,
          hint: 'Go to Admin → Settings → Facebook Configuration, enter your Facebook App ID and App Secret, then click "Save Configuration".',
          debug: {
            hasSystemAppId: !!systemSettingAppId,
            hasSystemAppSecret: !!systemSettingAppSecret,
            hasEnvAppId: !!envAppId,
            hasEnvAppSecret: !!envAppSecret,
            tenantId,
            storeId: storeId || null,
          }
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

    // Log full OAuth URL for debugging
    console.log('[Facebook Connect] ========================================')
    console.log('[Facebook Connect] 🔗 OAuth Configuration:')
    console.log('[Facebook Connect]   App ID:', trimmedAppId)
    console.log('[Facebook Connect]   Redirect URI:', redirectUri)
    console.log('[Facebook Connect]   App Domain:', appDomain)
    console.log('[Facebook Connect]   Full OAuth URL:', facebookAuthUrl)
    console.log('[Facebook Connect] ========================================')
    console.log('[Facebook Connect] ⚠️  IMPORTANT: Make sure in Facebook Developer Console:')
    console.log('[Facebook Connect]   1. Go to Settings > Basic')
    console.log('[Facebook Connect]   2. Add this EXACT URL to "Valid OAuth Redirect URIs":')
    console.log('[Facebook Connect]      ', redirectUri)
    console.log('[Facebook Connect]   3. Add this domain to "App Domains":')
    console.log('[Facebook Connect]      ', appDomain)
    console.log('[Facebook Connect]   4. Enable "Client OAuth Login" and "Web OAuth Login"')
    console.log('[Facebook Connect] ========================================')
    
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

