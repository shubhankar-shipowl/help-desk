import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { notificationService } from '../services/notification-service';
import { prisma } from '../config/database';

const router = Router();

// GET /notifications/preferences
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const preferences = await notificationService.getUserPreferences(userId);

    res.json({ preferences });
  } catch (error: any) {
    console.error('[Notifications] Error fetching preferences:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch preferences' });
  }
});

// PATCH /notifications/preferences
router.patch('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { notificationType, ...updates } = req.body;

    if (!notificationType) {
      res.status(400).json({ error: 'notificationType is required' });
      return;
    }

    const preference = await prisma.notificationPreference.upsert({
      where: {
        userId_notificationType: {
          userId,
          notificationType,
        },
      },
      update: updates,
      create: {
        userId,
        notificationType,
        ...updates,
      },
    });

    res.json({ success: true, preference });
  } catch (error: any) {
    console.error('[Notifications] Error updating preference:', error);
    res.status(500).json({ error: error.message || 'Failed to update preference' });
  }
});

export { router as preferencesRouter };
