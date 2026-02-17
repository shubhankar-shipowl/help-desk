import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { prisma } from '../config/database';
import { clearSystemSettingsCache } from '../services/system-settings';
import crypto from 'crypto';

const router = Router();

// GET /facebook/config
router.get('/', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }

    const storeId = req.query.storeId as string | null || null;

    const settings = await prisma.systemSettings.findMany({
      where: {
        tenantId,
        storeId,
        key: {
          in: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET', 'FACEBOOK_WEBHOOK_VERIFY_TOKEN', 'FACEBOOK_PAGE_ACCESS_TOKEN'],
        },
      },
    });

    const config: Record<string, string> = {};
    settings.forEach((setting: { key: string; value: string }) => {
      config[setting.key] = setting.value;
    });

    res.json({
      config: {
        facebookAppId: config.FACEBOOK_APP_ID || '',
        facebookAppSecret: config.FACEBOOK_APP_SECRET || '',
        facebookWebhookVerifyToken: config.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '',
        facebookPageAccessToken: config.FACEBOOK_PAGE_ACCESS_TOKEN || '',
      },
    });
  } catch (error: any) {
    console.error('Error fetching Facebook config:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch configuration' });
  }
});

// POST /facebook/config
router.post('/', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }

    const { facebookAppId, facebookAppSecret, facebookWebhookVerifyToken, facebookPageAccessToken, storeId } = req.body;

    if (!facebookAppId || !facebookAppSecret) {
      res.status(400).json({ error: 'Facebook App ID and App Secret are required' });
      return;
    }

    const trimmedAppId = facebookAppId.trim();
    if (!/^\d{15,20}$/.test(trimmedAppId)) {
      res.status(400).json({ error: 'Facebook App ID should be 15-20 digits (numeric only)' });
      return;
    }

    const settingsToSave = [
      { key: 'FACEBOOK_APP_ID', value: trimmedAppId },
      { key: 'FACEBOOK_APP_SECRET', value: facebookAppSecret },
      { key: 'FACEBOOK_WEBHOOK_VERIFY_TOKEN', value: facebookWebhookVerifyToken || 'fb_verify_2025' },
      { key: 'FACEBOOK_PAGE_ACCESS_TOKEN', value: facebookPageAccessToken || '' },
    ];

    for (const setting of settingsToSave) {
      const existing = await prisma.systemSettings.findFirst({
        where: {
          tenantId,
          storeId: storeId || null,
          key: setting.key,
        },
      });

      if (existing) {
        await prisma.systemSettings.update({
          where: { id: existing.id },
          data: { value: setting.value },
        });
      } else {
        await prisma.systemSettings.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            storeId: storeId || null,
            key: setting.key,
            value: setting.value,
            updatedAt: new Date(),
          },
        });
      }
    }

    clearSystemSettingsCache(tenantId, storeId || null);
    if (storeId) {
      clearSystemSettingsCache(tenantId, null);
    }

    res.json({ success: true, message: 'Facebook configuration saved successfully' });
  } catch (error: any) {
    console.error('Error saving Facebook config:', error);
    res.status(500).json({ error: error.message || 'Failed to save configuration' });
  }
});

export { router as configRouter };
