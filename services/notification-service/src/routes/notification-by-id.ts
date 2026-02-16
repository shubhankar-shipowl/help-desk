import { Router, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth';
import { notificationService } from '../services/notification-service';

const router = Router();

// PATCH /notifications/:id - Mark notification as read
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const notification = await notificationService.markAsRead(req.params.id, userId);

    res.json({ success: true, notification });
  } catch (error: any) {
    console.error('[Notifications] Error marking notification as read:', error);
    res.status(500).json({ error: error.message || 'Failed to mark notification as read' });
  }
});

// DELETE /notifications/:id - Delete notification (admin only)
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.id;
    const userRole = req.user!.role;

    if (userRole !== 'ADMIN') {
      res.status(403).json({ error: 'Only administrators can delete notifications' });
      return;
    }

    await notificationService.deleteNotification(req.params.id, userId);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Notifications] Error deleting notification:', error);
    res.status(500).json({ error: error.message || 'Failed to delete notification' });
  }
});

export { router as notificationByIdRouter };
