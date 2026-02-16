import { Router, Request, Response, NextFunction } from 'express';
import { formatPhoneForExotel } from '../services/exotel-service';

const router = Router();

/**
 * Validate Exotel webhook shared secret.
 * Configure your Exotel webhook URL with ?secret=YOUR_SECRET
 * and set EXOTEL_WEBHOOK_SECRET in your environment.
 */
function validateExotelSecret(req: Request, res: Response, next: NextFunction): void {
  const webhookSecret = process.env.EXOTEL_WEBHOOK_SECRET;

  if (!webhookSecret) {
    // No secret configured - skip validation (log warning)
    console.warn('[Exotel Webhook] EXOTEL_WEBHOOK_SECRET not configured - skipping validation');
    next();
    return;
  }

  const providedSecret = req.query.secret as string | undefined;
  if (!providedSecret || providedSecret !== webhookSecret) {
    console.error('[Exotel Webhook] Invalid or missing webhook secret');
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}

/**
 * Exotel Webhook Handler
 * Called by Exotel when the agent answers the call.
 * Returns XML that tells Exotel to dial the customer.
 * PUBLIC endpoint - validated via shared secret.
 */
function handleWebhook(req: Request, res: Response): void {
  try {
    console.log('[Exotel Webhook] ========================================');
    console.log('[Exotel Webhook] AGENT ANSWERED - Now dialing customer');
    console.log('[Exotel Webhook] ========================================');

    const customerPhoneFromQuery = req.query.customer_phone as string | undefined;

    // Get call parameters from Exotel (URL-encoded form data or query params)
    const body = req.body || {};
    const callSid = body.CallSid || req.query.CallSid || '';
    const from = body.From || req.query.From || '';
    const to = body.To || req.query.To || '';
    const callerId = body.CallerId || req.query.CallerId || process.env.CALLER_ID || '';

    const customerPhone = to;

    console.log('[Exotel Webhook] Call details from Exotel:', {
      callSid,
      from: from || '(not provided)',
      to: to || '(not provided)',
      exotelCallerId: callerId || '(not set)',
    });

    if (!customerPhone || customerPhone.toString().trim() === '') {
      console.error('[Exotel Webhook] CRITICAL ERROR: Customer phone not provided!');

      res.status(200).set('Content-Type', 'application/xml; charset=utf-8').send(
        `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Error: Customer phone number was not provided to the system. The call cannot be connected. Please contact support.</Say>
  <Hangup/>
</Response>`
      );
      return;
    }

    const exotelCallerId = callerId || process.env.CALLER_ID || '';

    // Normalize phone number for Exotel Dial command (10-digit format)
    let normalizedPhone = formatPhoneForExotel(customerPhone);

    if (normalizedPhone.startsWith('+91')) {
      normalizedPhone = normalizedPhone.substring(3);
    } else if (normalizedPhone.startsWith('+')) {
      normalizedPhone = normalizedPhone.substring(1);
    }

    console.log('[Exotel Webhook] Dialing customer:', {
      customerPhone: normalizedPhone,
      callerId: exotelCallerId,
    });

    const xmlResponse = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${exotelCallerId}" timeout="30">
    <Number>${normalizedPhone}</Number>
  </Dial>
</Response>`;

    res.status(200).set('Content-Type', 'application/xml; charset=utf-8').send(xmlResponse);
  } catch (error: any) {
    console.error('[Exotel Webhook] ERROR:', error.message);

    res.status(200).set('Content-Type', 'application/xml; charset=utf-8').send(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Error processing call. Please try again.</Say>
  <Hangup/>
</Response>`
    );
  }
}

router.post('/', validateExotelSecret, handleWebhook);
router.get('/', validateExotelSecret, handleWebhook);

export { router as exotelWebhookRouter };
