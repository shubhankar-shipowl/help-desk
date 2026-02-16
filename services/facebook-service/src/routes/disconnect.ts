import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

// DELETE /facebook/disconnect
router.delete('/', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const pageId = req.query.pageId as string | undefined;

    if (!pageId) {
      res.status(400).json({ error: 'Page ID is required' });
      return;
    }

    const integration = await prisma.facebookIntegration.findFirst({
      where: { pageId },
    });

    if (!integration) {
      res.status(404).json({ error: 'Integration not found' });
      return;
    }

    try {
      const unsubscribeResponse = await fetch(
        `https://graph.facebook.com/v18.0/${pageId}/subscribed_apps?access_token=${integration.accessToken}`,
        { method: 'DELETE' }
      );

      if (unsubscribeResponse.ok) {
        console.log(`[Facebook Disconnect] Unsubscribed page ${pageId} from webhook`);
      }
    } catch (fbError: any) {
      console.warn(`[Facebook Disconnect] Error unsubscribing:`, fbError.message);
    }

    await prisma.facebookIntegration.delete({
      where: { id: integration.id },
    });

    res.json({ success: true, message: 'Facebook page disconnected successfully' });
  } catch (error: any) {
    console.error('Error disconnecting Facebook page:', error);
    res.status(500).json({ error: error.message || 'Failed to disconnect Facebook page' });
  }
});

export { router as disconnectRouter };
