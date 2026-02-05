import { NextRequest, NextResponse } from 'next/server';
import { formatPhoneForExotel } from '@/lib/exotel-call-service';

/**
 * Exotel Webhook Handler
 *
 * This endpoint is called by Exotel when the agent answers the call.
 * It returns Exotel XML that tells Exotel to dial the customer and connect them.
 *
 * IMPORTANT: This endpoint must be publicly accessible (no authentication required)
 * as Exotel needs to call it directly.
 *
 * Correct Flow According to Exotel API Documentation:
 * 1. System initiates call: POST to /v1/Accounts/{SID}/Calls/connect
 *    - From: Agent's number (will be called first)
 *    - To: Customer's number (will be called after agent answers)
 *    - Url: Webhook URL (for call flow control)
 *    - CallerId: Your Exotel number
 *
 * 2. Exotel dials agent's number (From field)
 *
 * 3. Agent answers the call
 *
 * 4. Exotel calls THIS webhook (the Url field from step 1)
 *
 * 5. This webhook returns XML with <Dial> command to call customer
 *
 * 6. Exotel dials customer number (from To field/XML response)
 *
 * 7. When customer answers, they are connected to the agent
 *
 * Environment Variables Required:
 * - EXOTEL_SID: Your Exotel Subscriber ID
 * - CALLER_ID: Your Exotel number (appears on customer's phone)
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[Exotel Webhook] ========================================');
    console.log('[Exotel Webhook] AGENT ANSWERED - Now dialing customer');
    console.log('[Exotel Webhook] ========================================');

    // Get customer phone from query parameter (passed in flow URL)
    const searchParams = req.nextUrl.searchParams;
    const customerPhoneFromQuery = searchParams.get('customer_phone');

    console.log('[Exotel Webhook] Query parameters:', {
      customer_phone: customerPhoneFromQuery,
    });

    // Exotel can send data as form data or URL-encoded
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (e) {
      // If form data parsing fails, try to get from body
      const body = await req.text();
      console.log('[Exotel Webhook] Raw body received:', body);
      formData = new FormData();
      // Parse URL-encoded data
      const params = new URLSearchParams(body);
      for (const [key, value] of params.entries()) {
        formData.append(key, value);
      }
    }

    // Get call parameters from Exotel
    const callSid = formData.get('CallSid')?.toString() || '';
    const from = formData.get('From')?.toString() || ''; // Agent's number
    const to = formData.get('To')?.toString() || ''; // Customer's number (from To field in API call)
    const callerId =
      formData.get('CallerId')?.toString() || process.env.CALLER_ID || '';

    // Get customer phone - from the To field (passed in API call)
    const customerPhone = to;

    // Log all received data for debugging
    console.log('[Exotel Webhook] Call details from Exotel:', {
      callSid,
      from: from || '(not provided)',
      to: to || '(not provided)',
      exotelCallerId: callerId || '(not set)',
    });

    console.log('[Exotel Webhook] Customer connection info:', {
      customerPhone: customerPhone || '(NOT FOUND - CRITICAL!)',
      source: customerPhoneFromQuery ? 'query_parameter' : 'fallback_to_field',
    });

    if (!customerPhone || customerPhone.trim() === '') {
      console.error(
        '[Exotel Webhook] ❌ CRITICAL ERROR: Customer phone not provided!',
      );
      console.error('[Exotel Webhook] Available data:', {
        customerPhoneFromQuery,
        to,
        callSid,
        from,
      });
      console.error(
        '[Exotel Webhook] This means the customer will NOT be dialed.',
      );

      // Return error response with message
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Error: Customer phone number was not provided to the system. The call cannot be connected. Please contact support.</Say>
  <Hangup/>
</Response>`,
        {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
          },
        },
      );
    }

    // Get caller ID from environment
    const exotelCallerId = callerId || process.env.CALLER_ID || '';

    if (!exotelCallerId) {
      console.warn(
        '[Exotel Webhook] ⚠️  CallerId not configured - using default',
      );
    }

    // Normalize phone number for Exotel using utility
    // The utility handles E.164 format conversion
    let normalizedPhone = formatPhoneForExotel(customerPhone);

    // For Exotel Dial command, we need 10-digit format (without +91 prefix for India)
    // Remove +91 if present to get 10-digit format
    if (normalizedPhone.startsWith('+91')) {
      normalizedPhone = normalizedPhone.substring(3); // Remove '+91'
    } else if (normalizedPhone.startsWith('+')) {
      // Remove any country code prefix
      normalizedPhone = normalizedPhone.substring(1);
    }

    console.log('[Exotel Webhook] Phone normalization:', {
      original: customerPhone,
      formatted: formatPhoneForExotel(customerPhone),
      dialNumber: normalizedPhone,
      format: `10-digit format for Exotel Dial`,
    });

    // Return Exotel XML that dials the customer
    // This tells Exotel to:
    // 1. Dial the customer number
    // 2. Use the callerId (your Exotel number) as the caller ID on customer's phone
    // 3. Connect the customer to the agent automatically
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${exotelCallerId}" timeout="30">
    <Number>${normalizedPhone}</Number>
  </Dial>
</Response>`;

    console.log('[Exotel Webhook] ✅ Dialing customer:', {
      customerPhone: normalizedPhone,
      callerId: exotelCallerId,
      timeout: '30 seconds',
    });
    console.log('[Exotel Webhook] Returning XML response to Exotel');

    return new NextResponse(xmlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
      },
    });
  } catch (error: any) {
    console.error('[Exotel Webhook] ❌ ERROR:', error.message);
    console.error('[Exotel Webhook] Error stack:', error.stack);

    // Return error response
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Error processing call. Please try again.</Say>
  <Hangup/>
</Response>`,
      {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
        },
      },
    );
  }
}

// Also handle GET requests (some Exotel configurations use GET)
export async function GET(req: NextRequest) {
  return POST(req);
}
