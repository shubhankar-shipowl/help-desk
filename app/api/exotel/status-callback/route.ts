import { NextRequest, NextResponse } from 'next/server';
import { handleExotelWebhook } from '@/lib/exotel-call-service';

/**
 * Exotel Status Callback Webhook
 *
 * This endpoint receives call status updates from Exotel.
 * Updates call logs with status and duration using the enhanced service.
 *
 * IMPORTANT: This endpoint must be publicly accessible (no authentication required)
 */
export async function POST(req: NextRequest) {
  try {
    console.log(
      '[Exotel Status Callback] ========================================',
    );
    console.log(
      '[Exotel Status Callback] Call status update received from Exotel',
    );
    console.log(
      '[Exotel Status Callback] ========================================',
    );

    // Parse request body - Exotel can send as URL-encoded, JSON, or form data
    let body: any = {};
    const contentType = req.headers.get('content-type') || '';

    console.log('[Exotel Status Callback] Content-Type:', contentType);

    try {
      if (contentType.includes('application/x-www-form-urlencoded')) {
        // URL-encoded form data (most common for Exotel)
        const text = await req.text();
        console.log('[Exotel Status Callback] Raw body:', text.substring(0, 500));
        const params = new URLSearchParams(text);
        for (const [key, value] of params.entries()) {
          body[key] = value;
        }
      } else if (contentType.includes('application/json')) {
        // JSON format
        body = await req.json();
      } else if (contentType.includes('multipart/form-data')) {
        // Multipart form data
        const formData = await req.formData();
        for (const [key, value] of formData.entries()) {
          body[key] = value.toString();
        }
      } else {
        // Try to parse as text and then URL-encoded (fallback)
        const text = await req.text();
        console.log('[Exotel Status Callback] Raw body (fallback):', text.substring(0, 500));
        try {
          body = JSON.parse(text);
        } catch {
          const params = new URLSearchParams(text);
          for (const [key, value] of params.entries()) {
            body[key] = value;
          }
        }
      }
    } catch (e: any) {
      console.error('[Exotel Status Callback] Failed to parse request body:', e.message);
      return NextResponse.json({ success: false }, { status: 200 });
    }

    console.log('[Exotel Status Callback] Received body:', {
      CallSid: body.CallSid,
      Status: body.Status,
      Outcome: body.Outcome,
      Duration: body.Duration,
      ConversationDuration: body.ConversationDuration,
      CustomField: body.CustomField,
    });

    // Get Exotel config for duration fetching retries
    const exotelConfig = {
      exotelSid: process.env.EXOTEL_SID || '',
      apiKey: process.env.EXOTEL_KEY || '',
      apiToken: process.env.EXOTEL_TOKEN || '',
    };

    // Process webhook using the enhanced handler with automatic retries
    const result = await handleExotelWebhook(body, exotelConfig);

    if (!result.success) {
      console.warn(
        '[Exotel Status Callback] Webhook processing failed:',
        result.error,
      );
      // Always return 200 to Exotel to prevent retries
      return NextResponse.json(
        { success: false, message: result.error },
        { status: 200 },
      );
    }

    console.log('[Exotel Status Callback] ✅ Webhook processed successfully');

    // Always return 200 to Exotel to prevent retries
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error('[Exotel Status Callback] Error:', error.message);
    // Always return 200 to Exotel to prevent retries
    return NextResponse.json({ success: false }, { status: 200 });
  }
}

// Also handle GET requests (some Exotel configurations use GET with query params)
export async function GET(req: NextRequest) {
  try {
    console.log('[Exotel Status Callback] GET request received');

    // Extract data from URL query parameters
    const url = new URL(req.url);
    const body: any = {};

    for (const [key, value] of url.searchParams.entries()) {
      body[key] = value;
    }

    console.log('[Exotel Status Callback] GET params:', {
      CallSid: body.CallSid,
      Status: body.Status,
      Outcome: body.Outcome,
      Duration: body.Duration,
    });

    if (!body.CallSid) {
      console.log('[Exotel Status Callback] No CallSid in GET params');
      return NextResponse.json({ success: false, error: 'No CallSid' }, { status: 200 });
    }

    // Get Exotel config
    const exotelConfig = {
      exotelSid: process.env.EXOTEL_SID || '',
      apiKey: process.env.EXOTEL_KEY || '',
      apiToken: process.env.EXOTEL_TOKEN || '',
    };

    // Process webhook
    const result = await handleExotelWebhook(body, exotelConfig);

    console.log('[Exotel Status Callback] GET result:', result.success ? 'success' : result.error);

    return NextResponse.json({ success: result.success }, { status: 200 });
  } catch (error: any) {
    console.error('[Exotel Status Callback] GET Error:', error.message);
    return NextResponse.json({ success: false }, { status: 200 });
  }
}
