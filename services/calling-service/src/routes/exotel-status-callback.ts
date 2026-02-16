import { Router, Request, Response, NextFunction } from 'express';
import { handleExotelWebhook } from '../services/exotel-service';

const router = Router();

/**
 * Validate Exotel webhook shared secret.
 * Configure your Exotel status callback URL with ?secret=YOUR_SECRET
 * and set EXOTEL_WEBHOOK_SECRET in your environment.
 */
function validateExotelSecret(req: Request, res: Response, next: NextFunction): void {
  const webhookSecret = process.env.EXOTEL_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.warn('[Exotel Status Callback] EXOTEL_WEBHOOK_SECRET not configured - skipping validation');
    next();
    return;
  }

  const providedSecret = req.query.secret as string | undefined;
  if (!providedSecret || providedSecret !== webhookSecret) {
    console.error('[Exotel Status Callback] Invalid or missing webhook secret');
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  next();
}

/**
 * Exotel Status Callback Webhook
 * Receives call status updates from Exotel.
 * Validated via shared secret.
 */
router.post('/', validateExotelSecret, async (req: Request, res: Response) => {
  try {
    console.log('[Exotel Status Callback] ========================================');
    console.log('[Exotel Status Callback] Call status update received from Exotel');
    console.log('[Exotel Status Callback] ========================================');

    // Express with urlencoded and json middleware already parses the body
    const body = req.body || {};

    console.log('[Exotel Status Callback] Received body:', {
      CallSid: body.CallSid,
      Status: body.Status,
      Outcome: body.Outcome,
      Duration: body.Duration,
      ConversationDuration: body.ConversationDuration,
      CustomField: body.CustomField,
    });

    const exotelConfig = {
      exotelSid: process.env.EXOTEL_SID || '',
      apiKey: process.env.EXOTEL_KEY || '',
      apiToken: process.env.EXOTEL_TOKEN || '',
    };

    const result = await handleExotelWebhook(body, exotelConfig);

    if (!result.success) {
      console.warn('[Exotel Status Callback] Webhook processing failed:', result.error);
      res.status(200).json({ success: false, message: result.error });
      return;
    }

    console.log('[Exotel Status Callback] Webhook processed successfully');
    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('[Exotel Status Callback] Error:', error.message);
    res.status(200).json({ success: false });
  }
});

// Also handle GET requests
router.get('/', validateExotelSecret, async (req: Request, res: Response) => {
  try {
    console.log('[Exotel Status Callback] GET request received');

    const body: any = {};
    for (const [key, value] of Object.entries(req.query)) {
      body[key] = value;
    }

    console.log('[Exotel Status Callback] GET params:', {
      CallSid: body.CallSid,
      Status: body.Status,
      Outcome: body.Outcome,
      Duration: body.Duration,
    });

    if (!body.CallSid) {
      res.status(200).json({ success: false, error: 'No CallSid' });
      return;
    }

    const exotelConfig = {
      exotelSid: process.env.EXOTEL_SID || '',
      apiKey: process.env.EXOTEL_KEY || '',
      apiToken: process.env.EXOTEL_TOKEN || '',
    };

    const result = await handleExotelWebhook(body, exotelConfig);

    console.log('[Exotel Status Callback] GET result:', result.success ? 'success' : result.error);

    res.status(200).json({ success: result.success });
  } catch (error: any) {
    console.error('[Exotel Status Callback] GET Error:', error.message);
    res.status(200).json({ success: false });
  }
});

export { router as exotelStatusCallbackRouter };
