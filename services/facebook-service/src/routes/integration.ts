import { Router, Request, Response } from 'express';
import { authMiddleware, requireAdmin } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

// GET /facebook/integration
router.get('/', authMiddleware, requireAdmin, async (req: Request, res: Response) => {
  try {
    const integration = await prisma.facebookIntegration.findFirst({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        pageId: true,
        pageName: true,
        isActive: true,
        notificationSettings: true,
        autoCreateSettings: true,
        createdAt: true,
      },
    });

    res.json({ integration });
  } catch (error: any) {
    console.error('Error fetching Facebook integration:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch integration' });
  }
});

export { router as integrationRouter };
