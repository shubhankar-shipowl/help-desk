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
      // Redirect to API handler for OAuth processing
      const params = new URLSearchParams()
      if (code) params.set('code', code)
      if (state) params.set('state', state)
      if (error) params.set('error', error)
      
      return NextResponse.redirect(`${getAppUrl()}/api/privacy-handler?${params.toString()}`)
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
