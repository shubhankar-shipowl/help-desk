import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { prisma } from '../config/database';
import { getSystemSetting, clearSystemSettingsCache } from '../services/system-settings';

const router = Router();

// GET /facebook/connect
router.get('/', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }

    const storeId = req.query.storeId as string | undefined;

    clearSystemSettingsCache(tenantId, storeId || null);

    let systemSettingAppId = await getSystemSetting('FACEBOOK_APP_ID', tenantId, storeId || null);
    let systemSettingAppSecret = await getSystemSetting('FACEBOOK_APP_SECRET', tenantId, storeId || null);

    if (!systemSettingAppId && storeId) {
      systemSettingAppId = await getSystemSetting('FACEBOOK_APP_ID', tenantId, null);
      systemSettingAppSecret = await getSystemSetting('FACEBOOK_APP_SECRET', tenantId, null);
    }

    if (!systemSettingAppId) {
      const directSettings = await prisma.systemSettings.findMany({
        where: {
          tenantId,
          key: { in: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'] },
        },
        orderBy: [{ storeId: 'desc' }],
      });

      const settingsMap: Record<string, string> = {};
      directSettings.forEach((s) => {
        if (!settingsMap[s.key]) {
          settingsMap[s.key] = s.value;
        }
      });

      if (settingsMap.FACEBOOK_APP_ID) {
        systemSettingAppId = settingsMap.FACEBOOK_APP_ID;
      }
      if (settingsMap.FACEBOOK_APP_SECRET) {
        systemSettingAppSecret = settingsMap.FACEBOOK_APP_SECRET;
      }
    }

    const envAppId = process.env.FACEBOOK_APP_ID;
    const envAppSecret = process.env.FACEBOOK_APP_SECRET;
    const appId = (systemSettingAppId || envAppId)?.trim();
    const appSecret = (systemSettingAppSecret || envAppSecret)?.trim();

    const facebookBaseUrl = process.env.FACEBOOK_REDIRECT_URI
      ? process.env.FACEBOOK_REDIRECT_URI.replace(/\/auth\/facebook\/callback$/, '').replace(/\/api\/facebook\/callback$/, '')
      : (process.env.APP_URL || 'https://support.shopperskart.shop');
    const redirectUri = `${facebookBaseUrl}/auth/facebook/callback`;

    if (!appId || !appSecret) {
      res.status(500).json({
        error: 'Facebook App ID or App Secret is not configured. Please configure it in Admin Settings.',
      });
      return;
    }

    const trimmedAppId = appId.trim();
    if (!/^\d{15,20}$/.test(trimmedAppId)) {
      res.status(500).json({
        error: `Invalid Facebook App ID format. App ID should be 15-20 digits (numeric only).`,
      });
      return;
    }

    const scopes = [
      'pages_show_list',
      'pages_manage_metadata',
      'pages_messaging',
    ].join(',');

    const facebookAuthUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${trimmedAppId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&response_type=code&state=${req.user!.id}`;

    console.log('[Facebook Connect] Generated OAuth URL for user:', req.user!.id);

    res.json({
      authUrl: facebookAuthUrl,
      redirectUri,
    });
  } catch (error: any) {
    console.error('Error generating Facebook OAuth URL:', error);
    res.status(500).json({ error: error.message || 'Failed to generate Facebook OAuth URL' });
  }
});

export { router as connectRouter };
