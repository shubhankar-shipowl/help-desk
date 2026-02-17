import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const EMAIL_SERVICE_URL = process.env.EMAIL_SERVICE_URL || 'http://localhost:4003'

/**
 * Proxy POST /api/emails/fetch to the email service.
 *
 * Next.js rewrite-proxy uses an internal HTTP client with limited timeout
 * control.  Long-running IMAP operations (60–120 s) cause the rewrite
 * proxy to drop the connection (ECONNRESET / socket hang up).
 *
 * This API route replaces the rewrite for this specific endpoint and gives
 * us full control over the upstream timeout via AbortController.
 */
export async function POST(req: NextRequest) {
  const controller = new AbortController()
  // 3 minutes – plenty for IMAP fetch + parse + store + MEGA upload
  const timeout = setTimeout(() => controller.abort(), 180_000)

  try {
    const body = await req.text()

    // Forward all headers the email-service needs (cookies for auth, content-type)
    const headers: Record<string, string> = {
      'Content-Type': req.headers.get('content-type') || 'application/json',
    }

    // Forward cookies so authMiddleware on the email service can decrypt the session
    const cookie = req.headers.get('cookie')
    if (cookie) {
      headers['cookie'] = cookie
    }

    const upstream = await fetch(`${EMAIL_SERVICE_URL}/emails/fetch`, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    })

    clearTimeout(timeout)

    const data = await upstream.text()

    return new NextResponse(data, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('content-type') || 'application/json' },
    })
  } catch (error: any) {
    clearTimeout(timeout)

    if (error.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Email fetch timed out after 3 minutes. Try fetching with a smaller limit.' },
        { status: 504 },
      )
    }

    console.error('[API /emails/fetch] Proxy error:', error.message)
    return NextResponse.json(
      { error: 'Email service temporarily unavailable. Please try again.' },
      { status: 502 },
    )
  }
}
