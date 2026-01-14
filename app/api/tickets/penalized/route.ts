import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get penalized tickets with filters
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const filter = searchParams.get('filter') || 'all' // all, penalized, not_penalized
    const vendor = searchParams.get('vendor') // Filter by vendor
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const storeId = searchParams.get('storeId')

    const skip = (page - 1) * limit

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Build where clause - only resolved tickets
    const where: any = {
      tenantId, // Always filter by tenant
      status: 'RESOLVED',
    }

    // For admins, storeId is required to filter data by store
    if (session.user.role === 'ADMIN') {
      if (!storeId) {
        return NextResponse.json(
          { error: 'Store ID is required for admin users' },
          { status: 400 }
        )
      }
      where.storeId = storeId
    } else if (storeId) {
      // For agents, storeId is optional
      where.storeId = storeId
    }

    // Filter by penalization status
    if (filter === 'penalized') {
      where.isPenalized = true
    } else if (filter === 'not_penalized') {
      where.isPenalized = false
    }

    // Date range filter
    if (startDate || endDate) {
      where.resolvedAt = {}
      if (startDate) {
        const start = new Date(startDate)
        start.setHours(0, 0, 0, 0)
        where.resolvedAt.gte = start
      }
      if (endDate) {
        const end = new Date(endDate)
        end.setHours(23, 59, 59, 999)
        where.resolvedAt.lte = end
      }
    }

    // Fetch tickets
    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        resolvedAt: 'desc',
      },
      skip,
      take: limit,
    })

    // Get order tracking data for tickets to filter by vendor (pickupWarehouse)
    const customerPhones = tickets
      .map(t => t.customer.phone)
      .filter((phone): phone is string => phone !== null && phone !== undefined)
      .map(phone => phone.replace(/[\s\-\(\)]/g, ''))

    // Build order tracking where clause with storeId filter
    const orderTrackingWhere: any = {
      tenantId,
      consigneeContact: { in: customerPhones },
    }
    if (storeId) {
      orderTrackingWhere.storeId = storeId
    }

    const orderTrackingData = customerPhones.length > 0
      ? await prisma.orderTrackingData.findMany({
          where: orderTrackingWhere,
          select: {
            consigneeContact: true,
            pickupWarehouse: true,
          },
        })
      : []

    // Create a map of phone -> vendor (pickupWarehouse)
    const phoneToVendorMap = new Map<string, string | null>()
    orderTrackingData.forEach(ot => {
      const normalizedPhone = ot.consigneeContact.replace(/[\s\-\(\)]/g, '')
      phoneToVendorMap.set(normalizedPhone, ot.pickupWarehouse)
    })

    // Filter tickets by vendor (pickupWarehouse) if vendor filter is provided
    let filteredTickets = tickets
    if (vendor) {
      filteredTickets = tickets.filter(ticket => {
        if (!ticket.customer.phone) return false
        const normalizedPhone = ticket.customer.phone.replace(/[\s\-\(\)]/g, '')
        const ticketVendor = phoneToVendorMap.get(normalizedPhone)
        return ticketVendor === vendor
      })
    }

    // Get total count
    let total: number
    if (vendor) {
      // If vendor filter is applied, we need to count tickets that match the vendor
      // Get all resolved tickets first
      const allTicketsForCount = await prisma.ticket.findMany({
        where,
        select: {
          id: true,
          customer: {
            select: {
              phone: true,
            },
          },
        },
      })
      
      // Get normalized phone numbers
      const allCustomerPhones = allTicketsForCount
        .map(t => t.customer.phone)
        .filter((phone): phone is string => phone !== null && phone !== undefined)
        .map(phone => phone.replace(/[\s\-\(\)]/g, ''))

      // Build order tracking where clause with storeId and vendor filter
      const vendorOrderTrackingWhere: any = {
        tenantId,
        consigneeContact: { in: allCustomerPhones },
        pickupWarehouse: vendor,
      }
      if (storeId) {
        vendorOrderTrackingWhere.storeId = storeId
      }

      // Get order tracking data for the specific vendor (pickupWarehouse)
      const vendorOrderTracking = allCustomerPhones.length > 0
        ? await prisma.orderTrackingData.findMany({
            where: vendorOrderTrackingWhere,
            select: {
              consigneeContact: true,
            },
          })
        : []

      // Create set of phone numbers that have this vendor
      const vendorPhoneSet = new Set(
        vendorOrderTracking.map(ot => ot.consigneeContact.replace(/[\s\-\(\)]/g, ''))
      )
      
      // Count tickets that match the vendor
      total = allTicketsForCount.filter(t => {
        if (!t.customer.phone) return false
        const normalizedPhone = t.customer.phone.replace(/[\s\-\(\)]/g, '')
        return vendorPhoneSet.has(normalizedPhone)
      }).length
    } else {
      total = await prisma.ticket.count({ where })
    }

    // Fetch penalizedBy user data separately if needed
    const penalizedByUserIds = tickets
      .filter((t) => t.penalizedBy)
      .map((t) => t.penalizedBy)
      .filter((id): id is string => id !== null)

    const penalizedByUsers = penalizedByUserIds.length > 0
      ? await prisma.user.findMany({
          where: {
            tenantId, // Security: Only access users from same tenant
            id: { in: penalizedByUserIds },
          },
          select: { id: true, name: true, email: true },
        })
      : []

    const penalizedByUsersMap = new Map(
      penalizedByUsers.map((user) => [user.id, user])
    )

    const formattedTickets = filteredTickets.map((ticket) => {
      const penalizedByUser = ticket.penalizedBy
        ? penalizedByUsersMap.get(ticket.penalizedBy)
        : null

      // Get vendor (pickupWarehouse) from order tracking
      const normalizedPhone = ticket.customer.phone?.replace(/[\s\-\(\)]/g, '') || ''
      const vendorValue = phoneToVendorMap.get(normalizedPhone) || null

      return {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        customerName: ticket.customer.name || ticket.customer.email,
        customerEmail: ticket.customer.email,
        issueType: ticket.subject,
        category: ticket.category?.name || 'N/A',
        resolvedAt: ticket.resolvedAt,
        penalizedAt: ticket.penalizedAt,
        isPenalized: ticket.isPenalized,
        refundAmount: ticket.refundAmount ? parseFloat(ticket.refundAmount.toString()) : null,
        penalizedBy: penalizedByUser?.name || null,
        createdAt: ticket.createdAt,
        vendor: vendorValue,
      }
    })

    return NextResponse.json({
      tickets: formattedTickets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    })
  } catch (error: any) {
    console.error('Error fetching penalized tickets:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch tickets' },
      { status: 500 }
    )
  }
}

