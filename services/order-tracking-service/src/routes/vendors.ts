import { Router, Request, Response } from 'express';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

// GET /order-tracking/vendors
router.get('/', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }

    const storeId = req.query.storeId as string | undefined;

    if (req.user!.role === 'ADMIN' && !storeId) {
      res.status(400).json({ error: 'Store ID is required for admin users' });
      return;
    }

    const where: any = { tenantId };
    if (storeId) where.storeId = storeId;

    const orderTrackingData = await prisma.orderTrackingData.findMany({
      where,
      select: { pickupWarehouse: true },
      distinct: ['pickupWarehouse'],
    });

    const vendors = orderTrackingData
      .map(ot => ot.pickupWarehouse)
      .filter((w): w is string => w !== null && w.trim() !== '')
      .sort();

    res.json({ vendors });
  } catch (error: any) {
    console.error('[Vendors] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch vendors' });
  }
});

export { router as vendorsRouter };
