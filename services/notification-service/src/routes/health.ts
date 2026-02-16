import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import Redis from 'ioredis';
import { getRedisUrl } from '../config/redis';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    let redisStatus = 'unknown';
    try {
      const redis = new Redis(getRedisUrl());
      await redis.ping();
      redisStatus = 'connected';
      redis.disconnect();
    } catch {
      redisStatus = 'disconnected';
    }

    res.json({
      status: 'healthy',
      service: 'notification-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected',
      redis: redisStatus,
    });
  } catch (error: any) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'notification-service',
      timestamp: new Date().toISOString(),
      database: 'disconnected',
      error: error.message,
    });
  }
});
