import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

// POST /facebook/integration/disconnect
router.post('/', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const integration = await prisma.facebookIntegration.findFirst({
      where: { isActive: true },
    });

    if (!integration) {
      res.status(404).json({ error: 'No active Facebook integration found' });
      return;
    }

    await prisma.facebookIntegration.update({
      where: { id: integration.id },
      data: { isActive: false },
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('Error disconnecting Facebook integration:', error);
    res.status(500).json({ error: error.message || 'Failed to disconnect' });
  }
});

export { router as integrationDisconnectRouter };
