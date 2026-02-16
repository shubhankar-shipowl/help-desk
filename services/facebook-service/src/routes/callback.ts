import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { getSystemSetting } from '../services/system-settings';
import crypto from 'crypto';

const router = Router();

// GET /facebook/callback - OAuth callback (public - redirect from Facebook)
router.get('/', async (req: Request, res: Response) => {
  try {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;
    const error = req.query.error as string | undefined;

    const appUrl = process.env.APP_URL || 'http://localhost:3002';

    if (error) {
      res.redirect(`${appUrl}/admin/integrations?error=${encodeURIComponent(error)}`);
      return;
    }

    if (!code) {
      res.redirect(`${appUrl}/admin/integrations?error=no_code`);
      return;
    }

    let tenantId: string | null = null;
    if (state) {
      const user = await prisma.user.findUnique({
        where: { id: state },
        select: { tenantId: true },
      });
      tenantId = user?.tenantId || null;
    }

    const appId = tenantId
      ? (await getSystemSetting('FACEBOOK_APP_ID', tenantId) || process.env.FACEBOOK_APP_ID)
      : process.env.FACEBOOK_APP_ID;
    const appSecret = tenantId
      ? (await getSystemSetting('FACEBOOK_APP_SECRET', tenantId) || process.env.FACEBOOK_APP_SECRET)
      : process.env.FACEBOOK_APP_SECRET;

    const facebookBaseUrl = process.env.FACEBOOK_REDIRECT_URI
      ? process.env.FACEBOOK_REDIRECT_URI.replace(/\/auth\/facebook\/callback$/, '').replace(/\/api\/facebook\/callback$/, '')
      : (process.env.APP_URL || 'https://support.shopperskart.shop');
    const redirectUri = `${facebookBaseUrl}/api/facebook/callback`;

    if (!appId || !appSecret) {
      res.redirect(`${appUrl}/admin/integrations?error=config_missing`);
      return;
    }

    const tokenUrl = `https://graph.facebook.com/v18.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`;

    const tokenResponse = await fetch(tokenUrl, { method: 'GET' });

    if (!tokenResponse.ok) {
      const errorData = await tokenResponse.json();
      console.error('Facebook token exchange error:', errorData);
      res.redirect(`${appUrl}/admin/integrations?error=token_exchange_failed`);
      return;
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    const pagesResponse = await fetch(
      `https://graph.facebook.com/v18.0/me/accounts?access_token=${accessToken}`,
      { method: 'GET' }
    );

    if (!pagesResponse.ok) {
      res.redirect(`${appUrl}/admin/integrations?error=pages_fetch_failed`);
      return;
    }

    const pagesData = await pagesResponse.json();
    const pages = pagesData.data || [];

    if (pages.length === 0) {
      res.redirect(`${appUrl}/admin/integrations?error=no_pages`);
      return;
    }

    for (const page of pages) {
      const webhookToken = tenantId
        ? (await getSystemSetting('FACEBOOK_WEBHOOK_VERIFY_TOKEN', tenantId) || process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'fb_verify_2025')
        : (process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'fb_verify_2025');

      if (!tenantId) {
        res.redirect(`${appUrl}/admin/integrations?error=tenant_id_required`);
        return;
      }

      await prisma.facebookIntegration.upsert({
        where: {
          tenantId_pageId: {
            tenantId,
            pageId: page.id,
          }
        },
        update: {
          pageName: page.name,
          accessToken: page.access_token,
          webhookToken,
          isActive: true,
          updatedAt: new Date(),
        },
        create: {
          id: crypto.randomUUID(),
          tenantId,
          pageId: page.id,
          pageName: page.name,
          accessToken: page.access_token,
          webhookToken,
          isActive: true,
          updatedAt: new Date(),
        },
      });

      try {
        const subscribeUrl = `https://graph.facebook.com/v18.0/${page.id}/subscribed_apps?subscribed_fields=feed,messages,mention&access_token=${page.access_token}`;
        const subscribeResponse = await fetch(subscribeUrl, { method: 'POST' });

        if (subscribeResponse.ok) {
          console.log(`[Facebook Callback] Subscribed page ${page.id} to feed, messages, mention`);
        } else {
          console.warn(`[Facebook Callback] Could not auto-subscribe page ${page.id}`);
        }
      } catch (subscribeError: any) {
        console.warn(`[Facebook Callback] Error subscribing page ${page.id}:`, subscribeError.message);
      }
    }

    res.redirect(`${appUrl}/admin/integrations?success=connected`);
  } catch (error: any) {
    console.error('Error in Facebook callback:', error);
    const appUrl = process.env.APP_URL || 'http://localhost:3002';
    res.redirect(`${appUrl}/admin/integrations?error=${encodeURIComponent(error.message || 'unknown_error')}`);
  }
});

export { router as callbackRouter };
