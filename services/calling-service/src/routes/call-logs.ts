import { Router, Request, Response } from 'express';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import { prisma } from '../config/database';

const router = Router();

// GET /call-logs
router.get('/', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }

    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '50');
    const ticketId = req.query.ticketId as string | undefined;
    const agentId = req.query.agentId as string | undefined;
    const customerPhone = req.query.customerPhone as string | undefined;
    const status = req.query.status as string | undefined;
    const remark = req.query.remark as string | undefined;
    const startDate = req.query.startDate as string | undefined;
    const endDate = req.query.endDate as string | undefined;

    const skip = (page - 1) * limit;

    const where: any = {
      User: {
        tenantId,
      },
    };

    if (req.user!.role === 'ADMIN') {
      if (agentId) {
        where.agentId = agentId;
      }
    } else if (req.user!.role === 'AGENT') {
      where.agentId = req.user!.id;
    }

    if (ticketId) {
      where.ticketId = ticketId;
    }

    if (customerPhone) {
      where.customerPhone = {
        contains: customerPhone,
      };
    }

    if (status) {
      where.status = status;
    }

    if (remark) {
      if (remark === 'HAS_REMARK') {
        where.AND = [
          { remark: { not: null } },
          { remark: { not: '' } },
          { remark: { not: '-' } },
        ];
      } else if (remark === 'NO_REMARK') {
        where.OR = [{ remark: null }, { remark: '' }, { remark: '-' }];
      }
    }

    if (startDate || endDate) {
      where.startedAt = {};
      if (startDate) {
        const start = new Date(startDate);
        start.setHours(0, 0, 0, 0);
        where.startedAt.gte = start;
      }
      if (endDate) {
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999);
        where.startedAt.lte = end;
      }
    }

    const datesWhere: any = {
      User: {
        tenantId,
      },
    };
    if (req.user!.role === 'AGENT') {
      datesWhere.agentId = req.user!.id;
    }

    const [callLogs, total, allCallLogs] = await Promise.all([
      prisma.callLog.findMany({
        where,
        include: {
          User: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          Ticket: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true,
            },
          },
        },
        orderBy: {
          startedAt: 'desc',
        },
        skip,
        take: limit,
      }),
      prisma.callLog.count({ where }),
      prisma.callLog.findMany({
        where: datesWhere,
        select: {
          startedAt: true,
        },
      }),
    ]);

    const formattedLogs = callLogs.map((log: any) => {
      const minutes = Math.floor(log.duration / 60);
      const seconds = log.duration % 60;
      const durationFormatted = `${minutes}:${seconds.toString().padStart(2, '0')}`;

      return {
        id: log.id,
        ticketId: log.ticketId,
        ticketNumber: log.Ticket?.ticketNumber,
        ticketSubject: log.Ticket?.subject,
        agentId: log.agentId,
        agentName: log.User.name,
        agentEmail: log.User.email,
        customerName: log.customerName,
        customerPhone: log.customerPhone,
        agentPhone: log.agentPhone,
        status: log.status,
        duration: log.duration,
        durationFormatted,
        attempts: log.attempts,
        remark: log.remark || '-',
        exotelCallId: log.exotelCallId,
        recordingUrl: (log as any).recordingUrl || null,
        startedAt: log.startedAt,
        endedAt: log.endedAt,
        createdAt: log.createdAt,
      };
    });

    const datesWithData = new Set<string>();
    allCallLogs.forEach((log: any) => {
      if (log.startedAt) {
        const dateStr = log.startedAt.toISOString().split('T')[0];
        datesWithData.add(dateStr);
      }
    });

    res.json({
      callLogs: formattedLogs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      datesWithData: Array.from(datesWithData),
    });
  } catch (error: any) {
    console.error('Error fetching call logs:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch call logs' });
  }
});

export { router as callLogsRouter };
