import { Router, Request, Response } from 'express';
import { optionalAuthMiddleware } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

// GET /order-tracking/lookup
router.get('/', optionalAuthMiddleware, async (req: Request, res: Response) => {
  try {
    let tenantId: string | null = null;

    if (req.user) {
      tenantId = req.user.tenantId;
    } else {
      // For public access, detect tenant from host header
      const hostname = req.headers['host'] || '';
      const subdomain = hostname.split('.')[0];
      const tenant = await prisma.tenant.findUnique({
        where: { slug: subdomain },
      });
      tenantId = tenant?.id || null;

      if (!tenantId) {
        const defaultTenant = await prisma.tenant.findUnique({
          where: { slug: 'default' },
        });
        tenantId = defaultTenant?.id || null;
      }
    }

    if (!tenantId) {
      res.status(400).json({ error: 'Unable to determine tenant' });
      return;
    }

    const phone = req.query.phone as string;
    const storeId = req.query.storeId as string | undefined;

    if (!phone) {
      res.status(400).json({ error: 'Phone number is required' });
      return;
    }

    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '');

    const where: any = { tenantId, consigneeContact: normalizedPhone };

    if (storeId) {
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId, isActive: true },
      });
      if (store) {
        where.storeId = storeId;
      }
    }

    const records = await prisma.orderTrackingData.findMany({
      where,
      orderBy: { uploadedAt: 'desc' },
      take: 10,
    });

    if (records.length === 0) {
      res.json({ found: false, message: 'No order tracking data found for this phone number' });
      return;
    }

    res.json({
      found: true,
      data: records.map((record: { channelOrderNumber: string | null; orderId: string | null; waybillNumber: string; consigneeContact: string; channelOrderDate: Date | null; deliveredDate: Date | null; pickupWarehouse: string; vendor: string | null }) => ({
        orderId: record.channelOrderNumber || record.orderId || '',
        channelOrderNumber: record.channelOrderNumber || record.orderId || '',
        trackingId: record.waybillNumber,
        phone: record.consigneeContact,
        channelOrderDate: record.channelOrderDate,
        deliveredDate: record.deliveredDate,
        pickupWarehouse: record.pickupWarehouse,
        vendor: record.vendor,
      })),
      orderId: records[0].channelOrderNumber || records[0].orderId || '',
      channelOrderNumber: records[0].channelOrderNumber || records[0].orderId || '',
      trackingId: records[0].waybillNumber,
      channelOrderDate: records[0].channelOrderDate,
      deliveredDate: records[0].deliveredDate,
      pickupWarehouse: records[0].pickupWarehouse,
      vendor: records[0].vendor,
    });
  } catch (error: any) {
    console.error('[Lookup] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to lookup order tracking data' });
  }
});

export { router as lookupRouter };
