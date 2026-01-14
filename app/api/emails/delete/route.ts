import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Delete emails
 * POST /api/emails/delete
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json()
    const { emailIds, deleteAll, storeId } = body

    // Build where clause
    const where: any = {
      tenantId,
    }

    // Add storeId filter if provided
    if (storeId) {
      where.storeId = storeId
    } else if (session.user.role === 'ADMIN') {
      // For admins, storeId is required
      return NextResponse.json(
        { error: 'Store ID is required for admin users' },
        { status: 400 }
      )
    }

    if (deleteAll) {
      // Delete all emails for the tenant/store
      const result = await prisma.email.deleteMany({
        where,
      })

      return NextResponse.json({
        success: true,
        message: `Deleted ${result.count} emails`,
        deletedCount: result.count,
      })
    } else if (emailIds && Array.isArray(emailIds) && emailIds.length > 0) {
      // Delete specific emails
      // First verify all emails belong to this tenant
      const emails = await prisma.email.findMany({
        where: {
          id: { in: emailIds },
          tenantId,
        },
        select: { id: true },
      })

      if (emails.length !== emailIds.length) {
        return NextResponse.json(
          { error: 'Some emails not found or unauthorized' },
          { status: 400 }
        )
      }

      const result = await prisma.email.deleteMany({
        where: {
          id: { in: emailIds },
          tenantId,
        },
      })

      return NextResponse.json({
        success: true,
        message: `Deleted ${result.count} email(s)`,
        deletedCount: result.count,
      })
    } else {
      return NextResponse.json(
        { error: 'No emails selected for deletion' },
        { status: 400 }
      )
    }
  } catch (error: any) {
    console.error('Error deleting emails:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete emails' },
      { status: 500 }
    )
  }
}
