import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get list of unique vendors from order tracking data
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Get storeId from query params
    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')

    // For admins, storeId is required to filter data by store
    if (session.user.role === 'ADMIN') {
      if (!storeId) {
        return NextResponse.json(
          { error: 'Store ID is required for admin users' },
          { status: 400 }
        )
      }
    }

    // Build where clause
    const where: any = { tenantId }
    if (storeId) {
      where.storeId = storeId
    }

    // Get all order tracking data with pickup warehouses (used as vendors)
    // Since pickupWarehouse is required, we don't need to check for null
    const orderTrackingData = await prisma.orderTrackingData.findMany({
      where,
      select: {
        pickupWarehouse: true,
      },
      distinct: ['pickupWarehouse'],
    })

    // Extract unique pickup warehouses (used as vendors)
    const vendors = orderTrackingData
      .map(ot => ot.pickupWarehouse)
      .filter((warehouse): warehouse is string => warehouse !== null && warehouse.trim() !== '')
      .sort()

    return NextResponse.json({
      vendors,
    })
  } catch (error: any) {
    console.error('Error fetching vendors:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch vendors' },
      { status: 500 }
    )
  }
}

