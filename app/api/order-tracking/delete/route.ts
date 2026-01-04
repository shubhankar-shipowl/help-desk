import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Delete all order tracking data
 * Only admins can delete all data
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    // Only admins can delete all order tracking data
    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized. Only admins can delete order tracking data.' }, { status: 401 })
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Get query parameter to confirm deletion
    const { searchParams } = new URL(req.url)
    const confirm = searchParams.get('confirm')

    if (confirm !== 'true') {
      return NextResponse.json(
        { error: 'Deletion must be confirmed. Add ?confirm=true to the request.' },
        { status: 400 }
      )
    }

    // Check if model exists
    if (!prisma.orderTrackingData) {
      console.error('OrderTrackingData model not found in Prisma client.')
      return NextResponse.json(
        { error: 'Order tracking service not available.' },
        { status: 503 }
      )
    }

    // Count existing records for this tenant
    const count = await prisma.orderTrackingData.count({
      where: { tenantId },
    })

    if (count === 0) {
      return NextResponse.json({
        success: true,
        message: 'No order tracking data to delete',
        deleted: 0,
      })
    }

    // Delete all records for this tenant
    const result = await prisma.orderTrackingData.deleteMany({
      where: { tenantId }, // Only delete data from this tenant
    })

    console.log(`[Order Tracking] Deleted ${result.count} records by admin ${session.user.id}`)

    return NextResponse.json({
      success: true,
      message: `Successfully deleted ${result.count} order tracking record(s)`,
      deleted: result.count,
    })
  } catch (error: any) {
    console.error('Error deleting order tracking data:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete order tracking data' },
      { status: 500 }
    )
  }
}

