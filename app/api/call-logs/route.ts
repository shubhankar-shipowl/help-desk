import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Get call logs
 * Only agents and admins can view call logs
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (
      !session ||
      (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId;
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 },
      );
    }

    const { searchParams } = new URL(req.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const ticketId = searchParams.get('ticketId');
    const agentId = searchParams.get('agentId');
    const customerPhone = searchParams.get('customerPhone');
    const status = searchParams.get('status');
    const remark = searchParams.get('remark');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    // Note: storeId is accepted but not used for call logs filtering
    // Admins see all call logs across all stores

    const skip = (page - 1) * limit;

    // Build where clause - filter by tenant through agent (User relation)
    const where: any = {
      User: {
        tenantId, // Filter by tenant through User relation
      },
    };

    // Handle filtering based on role
    if (session.user.role === 'ADMIN') {
      // Admins can see all call logs across all stores (no store filtering)
      // Admin can filter by agent if provided
      if (agentId) {
        where.agentId = agentId;
      }
    } else if (session.user.role === 'AGENT') {
      // For agents, only show their own calls
      where.agentId = session.user.id;
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

    // Remark filter
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

    // Date range filter
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

    // Build where clause for dates (without agent restriction for calendar dots)
    const datesWhere: any = {
      User: {
        tenantId, // Filter by tenant through User relation
      },
    };
    if (session.user.role === 'AGENT') {
      datesWhere.agentId = session.user.id;
    }

    // Fetch call logs with related data
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
      // Get all call logs to extract unique dates (for calendar dots)
      prisma.callLog.findMany({
        where: datesWhere,
        select: {
          startedAt: true,
        },
      }),
    ]);

    // Format duration for display
    const formattedLogs = callLogs.map((log) => {
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

    // Extract unique dates with call logs
    const datesWithData = new Set<string>();
    allCallLogs.forEach((log) => {
      if (log.startedAt) {
        const dateStr = log.startedAt.toISOString().split('T')[0];
        datesWithData.add(dateStr);
      }
    });

    return NextResponse.json({
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
    return NextResponse.json(
      { error: error.message || 'Failed to fetch call logs' },
      { status: 500 },
    );
  }
}
