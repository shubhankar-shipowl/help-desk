import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { notificationService } from '../services/notification-service';

const router = Router();

// PATCH /notifications/mark-all-read
router.patch('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const storeId = (req.query.storeId as string) || null;

    const count = await notificationService.markAllAsRead(userId, storeId);

    res.json({ success: true, count });
  } catch (error: any) {
    console.error('[Notifications] Error marking all as read:', error);
    res.status(500).json({ error: error.message || 'Failed to mark all as read' });
  }
});

export { router as markAllReadRouter };
