import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { notificationService } from '../services/notification-service';

const router = Router();

// GET /notifications/unread-count
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;

    if (!userId || typeof userId !== 'string') {
      res.status(401).json({ error: 'Invalid user session' });
      return;
    }

    const storeId = (req.query.storeId as string) || null;
    const count = await notificationService.getUnreadCount(userId, storeId);

    res.json({ count: count || 0 });
  } catch (error: any) {
    console.error('[Notifications] Error fetching unread count:', error);
    res.status(500).json({
      error: error.message || 'Failed to fetch unread count',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

export { router as unreadCountRouter };
