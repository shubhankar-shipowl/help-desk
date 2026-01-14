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

    // Get query parameters
    const { searchParams } = new URL(req.url)
    const confirm = searchParams.get('confirm')
    const storeId = searchParams.get('storeId')

    if (confirm !== 'true') {
      return NextResponse.json(
        { error: 'Deletion must be confirmed. Add ?confirm=true to the request.' },
        { status: 400 }
      )
    }

    // For admins, storeId is required to filter data by store
    if (session.user.role === 'ADMIN' && !storeId) {
      return NextResponse.json(
        { error: 'Store ID is required for admin users' },
        { status: 400 }
      )
    }

    // Validate storeId if provided
    if (storeId) {
      const store = await prisma.store.findFirst({
        where: {
          id: storeId,
          tenantId,
          isActive: true,
        },
      })
      
      if (!store) {
        return NextResponse.json(
          { error: 'Invalid store ID or store does not belong to this tenant' },
          { status: 400 }
        )
      }
    }

    // Check if model exists
    if (!prisma.orderTrackingData) {
      console.error('OrderTrackingData model not found in Prisma client.')
      return NextResponse.json(
        { error: 'Order tracking service not available.' },
        { status: 503 }
      )
    }

    // Build where clause
    const where: any = { tenantId }
    if (storeId) {
      where.storeId = storeId
    }

    // Count existing records
    const count = await prisma.orderTrackingData.count({ where })

    if (count === 0) {
      return NextResponse.json({
        success: true,
        message: 'No order tracking data to delete',
        deleted: 0,
      })
    }

    // Delete records
    const result = await prisma.orderTrackingData.deleteMany({ where })

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

