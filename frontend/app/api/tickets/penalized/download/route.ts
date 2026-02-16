import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

/**
 * Download penalized or all resolved tickets as Excel
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || 'penalized' // penalized or all
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const storeId = searchParams.get('storeId')

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // For admins, storeId is required to filter data by store
    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required for admin users' },
        { status: 400 }
      )
    }

    // Build where clause
    const where: any = {
      tenantId, // Always filter by tenant
      storeId, // Filter by store
      status: 'RESOLVED',
    }

    if (type === 'penalized') {
      where.isPenalized = true
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

    // Fetch all tickets (no pagination for download)
    const tickets = await prisma.ticket.findMany({
      where,
      include: {
        User_Ticket_customerIdToUser: {
          select: {
            name: true,
            email: true,
            phone: true,
          },
        },
        Category: {
          select: {
            name: true,
          },
        },
      },
      orderBy: {
        resolvedAt: 'desc',
      },
    })

    // Get order tracking data to fetch vendor (pickupWarehouse) information
    const customerPhones = tickets
      .map((t: any) => t.User_Ticket_customerIdToUser.phone)
      .filter((phone: any): phone is string => phone !== null && phone !== undefined)
      .map((phone: string) => phone.replace(/[\s\-\(\)]/g, ''))

    // Build order tracking where clause with storeId filter
    const orderTrackingWhere: any = {
      tenantId,
      storeId, // Filter by store
      consigneeContact: { in: customerPhones },
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
    const phoneToVendorMap = new Map<string, string>()
    orderTrackingData.forEach((ot: any) => {
      const normalizedPhone = ot.consigneeContact.replace(/[\s\-\(\)]/g, '')
      phoneToVendorMap.set(normalizedPhone, ot.pickupWarehouse)
    })

    // Helper function to extract AWB/Tracking ID from description
    const extractTrackingId = (description: string): string => {
      if (!description) return 'N/A'
      
      // Look for "Tracking ID: " pattern
      const trackingIdMatch = description.match(/Tracking ID:\s*([^\n]+)/i)
      if (trackingIdMatch && trackingIdMatch[1]) {
        return trackingIdMatch[1].trim()
      }
      
      // Also check for "AWB:" pattern as alternative
      const awbMatch = description.match(/AWB:\s*([^\n]+)/i)
      if (awbMatch && awbMatch[1]) {
        return awbMatch[1].trim()
      }
      
      return 'N/A'
    }

    // Format data for Excel
    const excelData = tickets.map((ticket: any) => {
      const awbNumber = extractTrackingId(ticket.description)
      
      // Get vendor (pickupWarehouse) from order tracking
      const normalizedPhone = ticket.User_Ticket_customerIdToUser?.phone?.replace(/[\s\-\(\)]/g, '') || ''
      const vendor = phoneToVendorMap.get(normalizedPhone) || 'N/A'

      return {
        'Ticket ID': ticket.ticketNumber,
        'Customer Name': ticket.User_Ticket_customerIdToUser?.name || 'N/A',
        'Customer Email': ticket.User_Ticket_customerIdToUser?.email || 'N/A',
        'Customer Phone': ticket.User_Ticket_customerIdToUser?.phone || 'N/A',
        'Vendor': vendor,
        'AWB Number': awbNumber,
        'Ticket Category': ticket.Category?.name || 'N/A',
        'Issue Type': ticket.subject,
        'Raised Date': ticket.createdAt.toLocaleDateString(),
        'Resolved Date': ticket.resolvedAt?.toLocaleDateString() || 'N/A',
        'Penalization Date': ticket.penalizedAt?.toLocaleDateString() || 'N/A',
        'Refund Amount': ticket.refundAmount ? parseFloat(ticket.refundAmount.toString()) : 'N/A',
      }
    })

    // Create workbook
    const workbook = XLSX.utils.book_new()
    const worksheet = XLSX.utils.json_to_sheet(excelData)

    // Set column widths
    const columnWidths = [
      { wch: 15 }, // Ticket ID
      { wch: 20 }, // Customer Name
      { wch: 25 }, // Customer Email
      { wch: 15 }, // Customer Phone
      { wch: 20 }, // Vendor
      { wch: 18 }, // AWB Number
      { wch: 20 }, // Ticket Category
      { wch: 30 }, // Issue Type
      { wch: 15 }, // Raised Date
      { wch: 15 }, // Resolved Date
      { wch: 18 }, // Penalization Date
      { wch: 15 }, // Refund Amount
    ]
    worksheet['!cols'] = columnWidths

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Tickets')

    // Generate buffer
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

    const filename = type === 'penalized' 
      ? `penalized-tickets-${new Date().toISOString().split('T')[0]}.xlsx`
      : `all-resolved-tickets-${new Date().toISOString().split('T')[0]}.xlsx`

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  } catch (error: any) {
    console.error('Error downloading tickets:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to download tickets' },
      { status: 500 }
    )
  }
}

