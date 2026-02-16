import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

// DELETE /order-tracking/delete
router.delete('/', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }

    const confirm = req.query.confirm as string;
    const storeId = req.query.storeId as string | undefined;

    if (confirm !== 'true') {
      res.status(400).json({ error: 'Deletion must be confirmed. Add ?confirm=true to the request.' });
      return;
    }

    if (!storeId) {
      res.status(400).json({ error: 'Store ID is required for admin users' });
      return;
    }

    const store = await prisma.store.findFirst({
      where: { id: storeId, tenantId, isActive: true },
    });
    if (!store) {
      res.status(400).json({ error: 'Invalid store ID or store does not belong to this tenant' });
      return;
    }

    const where: any = { tenantId };
    if (storeId) where.storeId = storeId;

    const count = await prisma.orderTrackingData.count({ where });
    if (count === 0) {
      res.json({ success: true, message: 'No order tracking data to delete', deleted: 0 });
      return;
    }

    const result = await prisma.orderTrackingData.deleteMany({ where });
    console.log(`[Order Tracking] Deleted ${result.count} records by admin ${req.user!.id}`);

    res.json({ success: true, message: `Successfully deleted ${result.count} order tracking record(s)`, deleted: result.count });
  } catch (error: any) {
    console.error('[Delete] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to delete order tracking data' });
  }
});

export { router as deleteRouter };
