import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Debug endpoint to test database connection
 * GET /api/debug/db-test
 */
export async function GET() {
  try {
    // Test basic connection
    const startTime = Date.now();

    // Try a simple query
    const userCount = await prisma.user.count();
    const callLogCount = await prisma.callLog.count();

    const endTime = Date.now();

    return NextResponse.json({
      success: true,
      message: 'Database connection successful',
      stats: {
        userCount,
        callLogCount,
        responseTimeMs: endTime - startTime,
      },
      databaseUrl: process.env.DATABASE_URL
        ? `${process.env.DATABASE_URL.split('@')[1]?.split('/')[0] || 'configured'}`
        : 'Not configured (using DB_* vars)',
    });
  } catch (error: any) {
    console.error('Database connection test failed:', error);

    return NextResponse.json({
      success: false,
      message: 'Database connection failed',
      error: error.message,
      hint: error.message.includes("Can't reach database server")
        ? 'The database server is not reachable. Check if: 1) Server is running, 2) Firewall allows port 3306, 3) MySQL is bound to 0.0.0.0'
        : 'Check your database credentials and connection settings',
    }, { status: 500 });
  }
}
