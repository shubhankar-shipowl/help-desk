import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'healthy',
      service: 'calling-service',
      timestamp: new Date().toISOString(),
      database: 'connected',
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'calling-service',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
    });
  }
});

export { router as healthRouter };
