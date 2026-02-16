import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';

export const emailDeleteRouter = Router();

emailDeleteRouter.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

    const { emailIds, deleteAll, storeId } = req.body;

    const where: any = { tenantId };

    if (storeId) {
      where.storeId = storeId;
    } else if (user.role === 'ADMIN') {
      return res.status(400).json({ error: 'Store ID is required for admin users' });
    }

    if (deleteAll) {
      const result = await prisma.email.deleteMany({ where });
      return res.json({ success: true, message: `Deleted ${result.count} emails`, deletedCount: result.count });
    } else if (emailIds && Array.isArray(emailIds) && emailIds.length > 0) {
      const emails = await prisma.email.findMany({
        where: { id: { in: emailIds }, tenantId },
        select: { id: true },
      });

      if (emails.length !== emailIds.length) {
        return res.status(400).json({ error: 'Some emails not found or unauthorized' });
      }

      const result = await prisma.email.deleteMany({
        where: { id: { in: emailIds }, tenantId },
      });

      return res.json({ success: true, message: `Deleted ${result.count} email(s)`, deletedCount: result.count });
    } else {
      return res.status(400).json({ error: 'No emails selected for deletion' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete emails' });
  }
});
