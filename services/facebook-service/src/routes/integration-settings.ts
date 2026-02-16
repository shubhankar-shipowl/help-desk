import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

// POST /facebook/integration/settings
router.post('/', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const { notificationSettings, autoCreateSettings } = req.body;

    const integration = await prisma.facebookIntegration.findFirst({
      where: { isActive: true },
    });

    if (!integration) {
      res.status(404).json({ error: 'No active Facebook integration found' });
      return;
    }

    const updated = await prisma.facebookIntegration.update({
      where: { id: integration.id },
      data: {
        notificationSettings: notificationSettings || {},
        autoCreateSettings: autoCreateSettings || {},
      },
    });

    res.json({
      success: true,
      integration: {
        id: updated.id,
        pageId: updated.pageId,
        pageName: updated.pageName,
        notificationSettings: updated.notificationSettings,
        autoCreateSettings: updated.autoCreateSettings,
      },
    });
  } catch (error: any) {
    console.error('Error updating Facebook integration settings:', error);
    res.status(500).json({ error: error.message || 'Failed to update settings' });
  }
});

export { router as integrationSettingsRouter };
