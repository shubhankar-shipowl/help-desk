import { NextRequest, NextResponse } from "next/server";

/**
 * Exotel Webhook Handler
 * 
 * This endpoint is called by Exotel when the agent answers the call.
 * It returns Exotel XML/TwiML that tells Exotel to dial the customer and connect them.
 * 
 * IMPORTANT: This endpoint must be publicly accessible (no authentication required)
 * as Exotel needs to call it directly.
 * 
 * Flow:
 * 1. Agent is called (From number)
 * 2. When agent answers, Exotel calls this webhook
 * 3. This webhook returns XML that tells Exotel to dial the customer (To number)
 * 4. Exotel calls the customer and connects them to the agent
 * 
 * Environment Variables Required:
 * - EXOTEL_SID: Your Exotel Subscriber ID
 * - CALLER_ID: Your Exotel number (appears on customer's phone)
 * 
 * Configuration:
 * Set FLOW_URL environment variable to: https://yourdomain.com/api/exotel/webhook
 * Or leave it empty to use this endpoint automatically
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[Exotel Webhook] Request received');
    
    // Exotel can send data as form data or URL-encoded
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch (e) {
      // If form data parsing fails, try to get from body
      const body = await req.text();
      console.log('[Exotel Webhook] Raw body:', body);
      formData = new FormData();
      // Parse URL-encoded data
      const params = new URLSearchParams(body);
      for (const [key, value] of params.entries()) {
        formData.append(key, value);
      }
    }
    
    // Get call parameters from Exotel
    const callSid = formData.get("CallSid")?.toString() || formData.get("CallSid")?.toString() || "";
    const from = formData.get("From")?.toString() || ""; // Agent's number
    const to = formData.get("To")?.toString() || ""; // Customer's number (if provided)
    const callerId = formData.get("CallerId")?.toString() || process.env.CALLER_ID || "";
    
    // Get customer phone from query parameter (passed in flow URL)
    const searchParams = req.nextUrl.searchParams;
    const customerPhoneFromQuery = searchParams.get("customer_phone");
    const customerPhone = customerPhoneFromQuery || to;
    
    // Log all received data for debugging
    console.log('[Exotel Webhook] Call answered - Full details:', {
      callSid,
      from,
      to,
      customerPhoneFromQuery,
      customerPhone,
      callerId,
      queryParams: Object.fromEntries(searchParams.entries()),
      formDataKeys: Array.from(formData.keys()),
    });

    if (!customerPhone || customerPhone.trim() === '') {
      console.error('[Exotel Webhook] Customer phone not provided. Available data:', {
        customerPhoneFromQuery,
        to,
        searchParams: Object.fromEntries(searchParams.entries()),
      });
      // Return error response
      return new NextResponse(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Error: Customer phone number not provided.</Say>
  <Hangup/>
</Response>`,
        {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
          },
        }
      );
    }

    // Get caller ID from SystemSettings or environment if not provided
    // Note: This is a public endpoint, so we can't use session. We'll use environment variable as fallback.
    // For tenant-specific caller ID, you may need to pass it via query parameter or use a default tenant lookup.
    const exotelCallerId = callerId || process.env.CALLER_ID || "";
    
    if (!exotelCallerId) {
      console.error('[Exotel Webhook] CallerId not configured');
    }

    // Normalize phone number for Exotel
    // Exotel expects 10-digit numbers for Indian numbers (without +91 prefix)
    let normalizedPhone = customerPhone.trim();
    // Remove any + prefix
    if (normalizedPhone.startsWith('+')) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    // Remove 91 prefix if present (Indian country code)
    if (normalizedPhone.startsWith('91') && normalizedPhone.length > 10) {
      normalizedPhone = normalizedPhone.substring(2);
    }
    // Remove leading 0 if present
    if (normalizedPhone.startsWith('0') && normalizedPhone.length > 10) {
      normalizedPhone = normalizedPhone.substring(1);
    }
    
    console.log('[Exotel Webhook] Phone normalization:', {
      original: customerPhone,
      normalized: normalizedPhone,
    });

    // Return Exotel XML/TwiML that dials the customer
    // This tells Exotel to:
    // 1. Dial the customer number
    // 2. Use the callerId (your Exotel number) as the caller ID
    // 3. Connect the customer to the agent when they answer
    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${exotelCallerId}" timeout="30" record="false">
    <Number>${normalizedPhone}</Number>
  </Dial>
</Response>`;

    console.log('[Exotel Webhook] Returning dial XML:', {
      originalPhone: customerPhone,
      normalizedPhone,
      callerId: exotelCallerId,
      xml: xmlResponse,
    });

    return new NextResponse(xmlResponse, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
      },
    });
  } catch (error: any) {
    console.error('[Exotel Webhook] Error:', error);
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
      }
    );
  }
}

// Also handle GET requests (some Exotel configurations use GET)
export async function GET(req: NextRequest) {
  return POST(req);
}

