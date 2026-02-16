import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';

export const emailByIdRouter = Router();

emailByIdRouter.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const email = await prisma.email.update({
      where: { id: req.params.id },
      data: { read: true, readAt: new Date() },
    });

    res.json({ success: true, email });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to mark email as read' });
  }
});
