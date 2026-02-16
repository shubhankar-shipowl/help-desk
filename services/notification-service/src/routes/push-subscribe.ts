import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { prisma } from '../config/database';
import crypto from 'crypto';

const router = Router();

// POST /notifications/push/subscribe
router.post('/subscribe', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { endpoint, keys } = req.body;

    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      res.status(400).json({ error: 'endpoint and keys (p256dh, auth) are required' });
      return;
    }

    // Check if subscription already exists
    const existing = await prisma.pushSubscription.findFirst({
      where: { userId, endpoint },
    });

    if (existing) {
      const subscription = await prisma.pushSubscription.update({
        where: { id: existing.id },
        data: {
          p256dh: keys.p256dh,
          auth: keys.auth,
          isActive: true,
          lastUsedAt: new Date(),
        },
      });

      res.json({ success: true, subscription });
      return;
    }

    // Create new subscription
    const subscription = await prisma.pushSubscription.create({
      data: {
        id: crypto.randomUUID(),
        userId,
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        userAgent: req.headers['user-agent'] || undefined,
        isActive: true,
        lastUsedAt: new Date(),
      },
    });

    res.json({ success: true, subscription });
  } catch (error: any) {
    console.error('[Notifications] Error subscribing to push:', error);
    res.status(500).json({ error: error.message || 'Failed to subscribe to push notifications' });
  }
});

export { router as pushSubscribeRouter };
