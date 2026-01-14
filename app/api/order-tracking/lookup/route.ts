import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Lookup Order ID and Tracking ID by phone number
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    // Get tenantId - can be from session or detected from domain
    let tenantId: string | null = null
    
    if (session) {
      tenantId = (session.user as any).tenantId
    } else {
      // For public access, try to detect tenant from domain/subdomain
      const hostname = req.headers.get('host') || ''
      const subdomain = hostname.split('.')[0]
      const tenant = await prisma.tenant.findUnique({
        where: { slug: subdomain },
      })
      tenantId = tenant?.id || null
      
      // Fallback to default tenant
      if (!tenantId) {
        const defaultTenant = await prisma.tenant.findUnique({
          where: { slug: 'default' },
        })
        tenantId = defaultTenant?.id || null
      }
    }

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Unable to determine tenant' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(req.url)
    const phone = searchParams.get('phone')
    const storeId = searchParams.get('storeId') // Get storeId from query params (for public URLs)

    if (!phone) {
      return NextResponse.json(
        { error: 'Phone number is required' },
        { status: 400 }
      )
    }

    // Normalize phone number (remove spaces, dashes, etc.)
    const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '')

    // Build where clause
    const where: any = {
      tenantId, // Always filter by tenant
      consigneeContact: normalizedPhone,
    }

    // Filter by storeId if provided (for public URLs with storeId in query params)
    if (storeId) {
      // Validate storeId belongs to tenant
      const store = await prisma.store.findFirst({
        where: {
          id: storeId,
          tenantId,
          isActive: true,
        },
      })
      
      if (store) {
        where.storeId = storeId
      }
    }

    // Find matching records
    // Note: If you get "Cannot read properties of undefined", restart the dev server
    // after running: npx prisma generate
    const records = await prisma.orderTrackingData.findMany({
      where,
      orderBy: {
        uploadedAt: 'desc',
      },
      take: 10, // Return up to 10 most recent matches
    })

    if (records.length === 0) {
      return NextResponse.json({
        found: false,
        message: 'No order tracking data found for this phone number',
      })
    }

    // Return the most recent record (or all if multiple)
    return NextResponse.json({
      found: true,
      data: records.map(record => ({
        orderId: record.channelOrderNumber || record.orderId || '', // Use channelOrderNumber, fallback to orderId
        channelOrderNumber: record.channelOrderNumber || record.orderId || '',
        trackingId: record.waybillNumber,
        phone: record.consigneeContact,
        channelOrderDate: record.channelOrderDate,
        deliveredDate: record.deliveredDate,
        pickupWarehouse: record.pickupWarehouse,
        vendor: record.vendor,
      })),
      // For backward compatibility, also return the first match directly
      orderId: records[0].channelOrderNumber || records[0].orderId || '',
      channelOrderNumber: records[0].channelOrderNumber || records[0].orderId || '',
      trackingId: records[0].waybillNumber,
      channelOrderDate: records[0].channelOrderDate,
      deliveredDate: records[0].deliveredDate,
      pickupWarehouse: records[0].pickupWarehouse,
      vendor: records[0].vendor,
    })
  } catch (error: any) {
    console.error('Error looking up order tracking data:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to lookup order tracking data' },
      { status: 500 }
    )
  }
}

