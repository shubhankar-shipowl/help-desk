import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get emails for the current user/store
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const read = searchParams.get('read') === 'true' ? true : searchParams.get('read') === 'false' ? false : undefined
    const storeId = searchParams.get('storeId')

    const skip = (page - 1) * limit

    // Build where clause
    const where: any = {
      tenantId,
    }

    // For admins, storeId is required to filter emails by store
    if (session.user.role === 'ADMIN') {
      if (!storeId) {
        return NextResponse.json(
          { error: 'Store ID is required for admin users' },
          { status: 400 }
        )
      }
      where.storeId = storeId
    } else if (session.user.role === 'AGENT' && storeId) {
      // For agents, storeId is optional
      where.storeId = storeId
    }
    // For customers, no storeId filtering - they see all their emails

    if (read !== undefined) {
      where.read = read
    }

    // Check if Email model exists
    if (!prisma.email) {
      console.error('[Emails API] Email model not found in Prisma Client. Please restart the server after running: npx prisma generate')
      return NextResponse.json(
        { error: 'Email service not available. Please restart the server and try again.' },
        { status: 503 }
      )
    }

    // Build base where clause for counts (without read filter)
    const baseWhere: any = {
      tenantId,
    }
    if (session.user.role === 'ADMIN') {
      if (storeId) {
        baseWhere.storeId = storeId
      }
    } else if (session.user.role === 'AGENT' && storeId) {
      baseWhere.storeId = storeId
    }

    // Fetch emails
    const [emails, total, unreadCount, readCount, totalAll] = await Promise.all([
      prisma.email.findMany({
        where,
        include: {
          ticket: {
            select: {
              id: true,
              ticketNumber: true,
              subject: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.email.count({ where }), // Count for current filter
      prisma.email.count({
        where: {
          ...baseWhere,
          read: false,
        },
      }),
      prisma.email.count({
        where: {
          ...baseWhere,
          read: true,
        },
      }),
      prisma.email.count({ where: baseWhere }), // Total count of all emails (no read filter)
    ])

    return NextResponse.json({
      emails,
      total,
      unreadCount,
      readCount,
      totalAll, // Total count of all emails regardless of read status
      page,
      totalPages: Math.ceil(total / limit),
    })
  } catch (error: any) {
    console.error('Error fetching emails:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch emails' },
      { status: 500 }
    )
  }
}
