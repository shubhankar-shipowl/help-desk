import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    // Get all call logs
    const allCalls = await prisma.callLog.findMany({
      include: {
        User: {
          select: {
            id: true,
            name: true,
            email: true,
            storeId: true,
            role: true,
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
      take: 20,
    });

    // Get call log count by status
    const statusCount = await prisma.callLog.groupBy({
      by: ['status'],
      _count: true,
    });

    // Get total count
    const totalCount = await prisma.callLog.count();

    // Get recent user sessions to find logged-in agents
    const recentUsers = await prisma.user.findMany({
      where: {
        role: {
          in: ['AGENT', 'ADMIN'],
        },
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        storeId: true,
      },
      take: 10,
    });

    return NextResponse.json({
      success: true,
      totalCallLogs: totalCount,
      statusBreakdown: statusCount,
      recentCallLogs: allCalls,
      agentsAndAdmins: recentUsers,
      message:
        totalCount === 0
          ? 'No call logs found in database'
          : `Found ${totalCount} call logs`,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: error.message,
      },
      { status: 500 },
    );
  }
}
