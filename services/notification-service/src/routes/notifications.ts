import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { notificationService } from '../services/notification-service';

const router = Router();

// GET /notifications - List notifications
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const readParam = req.query.read as string;
    const read = readParam === 'true' ? true : readParam === 'false' ? false : undefined;
    const type = req.query.type as any;
    const storeId = (req.query.storeId as string) || null;

    const result = await notificationService.getNotifications(userId, {
      page,
      limit,
      read,
      type,
      storeId,
    });

    res.json(result);
  } catch (error: any) {
    console.error('[Notifications] Error fetching notifications:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch notifications' });
  }
});

// PATCH /notifications - Batch mark as read
router.patch('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const { notificationIds, read } = req.body;

    if (!notificationIds || !Array.isArray(notificationIds)) {
      res.status(400).json({ error: 'notificationIds array is required' });
      return;
    }

    for (const id of notificationIds) {
      if (read !== false) {
        await notificationService.markAsRead(id, userId);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Notifications] Error updating notifications:', error);
    res.status(500).json({ error: error.message || 'Failed to update notifications' });
  }
});

export { router as notificationsRouter };
