import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import * as XLSX from 'xlsx'

export const dynamic = 'force-dynamic'

/**
 * Upload and parse Excel/CSV sheet with order tracking data
 * Required columns: Consignee Contact (phone), Channel Order Number, WayBill Number (tracking ID), Pickup Warehouse
 * Optional columns: Channel Order Date, Delivered Date, Vendor
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    // Only admins and agents can upload sheets
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

    // Get storeId from form data or query params
    const formData = await req.formData()
    const file = formData.get('file') as File
    const storeId = formData.get('storeId') as string | null

    // For admins, storeId is required
    if (session.user.role === 'ADMIN' && !storeId) {
      return NextResponse.json(
        { error: 'Store ID is required for admin users' },
        { status: 400 }
      )
    }

    // Validate storeId if provided (must belong to the tenant)
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

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate file type
    const fileName = file.name.toLowerCase()
    const isValidFileType = 
      fileName.endsWith('.xlsx') || 
      fileName.endsWith('.xls') || 
      fileName.endsWith('.csv')

    if (!isValidFileType) {
      return NextResponse.json(
        { error: 'Invalid file type. Please upload Excel (.xlsx, .xls) or CSV (.csv) file' },
        { status: 400 }
      )
    }

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Parse Excel/CSV file
    let workbook: XLSX.WorkBook
    try {
      workbook = XLSX.read(buffer, { type: 'buffer' })
    } catch (error: any) {
      console.error('Error parsing file:', error)
      return NextResponse.json(
        { error: 'Failed to parse file. Please ensure it is a valid Excel or CSV file.' },
        { status: 400 }
      )
    }

    // Get first sheet
    const sheetName = workbook.SheetNames[0]
    const worksheet = workbook.Sheets[sheetName]

    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false })

    if (!Array.isArray(data) || data.length === 0) {
      return NextResponse.json(
        { error: 'Sheet is empty or invalid format' },
        { status: 400 }
      )
    }

    // Find column mappings (case-insensitive, handle variations)
    const firstRow = data[0] as any
    const columns = Object.keys(firstRow)

    // Find column indices (case-insensitive)
    const findColumn = (searchTerms: string[]) => {
      for (const term of searchTerms) {
        const found = columns.find(col => 
          col.toLowerCase().trim() === term.toLowerCase().trim()
        )
        if (found) return found
      }
      return null
    }

    const phoneColumn = findColumn([
      'Consignee Contact',
      'consignee contact',
      'ConsigneeContact',
      'Phone',
      'phone',
      'Contact',
      'contact'
    ])

    const channelOrderNumberColumn = findColumn([
      'Channel Order Number',
      'channel order number',
      'ChannelOrderNumber',
      'channelordernumber',
      'OrderId', // Keep for backward compatibility
      'Order ID',
      'order id',
      'OrderID',
      'orderid'
    ])

    const trackingIdColumn = findColumn([
      'WayBill Number',
      'WayBill Number',
      'waybill number',
      'WayBillNumber',
      'Tracking ID',
      'tracking id',
      'TrackingID',
      'trackingid'
    ])

    // Optional columns
    const channelOrderDateColumn = findColumn([
      'Channel Order Date',
      'channel order date',
      'ChannelOrderDate',
      'channelorderdate',
      'Order Date',
      'order date',
      'OrderDate',
      'orderdate'
    ])

    const deliveredDateColumn = findColumn([
      'Delivered Date',
      'delivered date',
      'DeliveredDate',
      'delivereddate',
      'Delivery Date',
      'delivery date',
      'DeliveryDate',
      'deliverydate'
    ])

    const pickupWarehouseColumn = findColumn([
      'Pickup Warehouse',
      'pickup warehouse',
      'PickupWarehouse',
      'pickupwarehouse',
      'Warehouse',
      'warehouse',
      'Pickup Location',
      'pickup location',
      'PickupLocation',
      'pickuplocation'
    ])

    const vendorColumn = findColumn([
      'Vendor',
      'vendor',
      'Vendor Name',
      'vendor name',
      'VendorName',
      'vendorname',
      'Seller',
      'seller',
      'Seller Name',
      'seller name'
    ])

    if (!phoneColumn || !channelOrderNumberColumn || !trackingIdColumn || !pickupWarehouseColumn) {
      return NextResponse.json(
        { 
          error: 'Required columns not found. Please ensure your sheet contains: Consignee Contact, Channel Order Number, WayBill Number, and Pickup Warehouse',
          foundColumns: columns,
          missing: {
            phone: !phoneColumn,
            channelOrderNumber: !channelOrderNumberColumn,
            trackingId: !trackingIdColumn,
            pickupWarehouse: !pickupWarehouseColumn
          }
        },
        { status: 400 }
      )
    }

    // Process and insert data
    const records: Array<{
      consigneeContact: string
      channelOrderNumber: string
      waybillNumber: string
      channelOrderDate: Date | null
      deliveredDate: Date | null
      pickupWarehouse: string
      vendor: string | null
    }> = []

    // Helper function to parse date from Excel/CSV (extract only date, no time)
    const parseDate = (dateValue: any): Date | null => {
      if (!dateValue) return null
      
      const dateStr = String(dateValue).trim()
      if (!dateStr || dateStr === '') return null

      // Extract only date part if datetime format
      // Handle formats like:
      // - "12/10/2025 6:25:19" -> "12/10/2025"
      // - "2025-12-08 09:03:34" -> "2025-12-08"
      // - "2025-12-08T09:03:34" -> "2025-12-08"
      let dateOnlyStr = dateStr
      
      // Split by space and take only the date part (handles "12/10/2025 6:25:19")
      if (dateStr.includes(' ')) {
        dateOnlyStr = dateStr.split(' ')[0]
      }
      
      // Remove time portion if present (handle formats like "2025-12-08T09:03:34")
      if (dateOnlyStr.includes('T')) {
        dateOnlyStr = dateOnlyStr.split('T')[0]
      }

      // Try parsing as date string (handles various formats including MM/DD/YYYY)
      // JavaScript Date can parse MM/DD/YYYY format
      const parsed = new Date(dateOnlyStr)
      if (!isNaN(parsed.getTime())) {
        // Set time to midnight to ensure only date is stored
        parsed.setHours(0, 0, 0, 0)
        return parsed
      }

      // Try parsing MM/DD/YYYY format explicitly if standard parsing failed
      const mmddyyyyMatch = dateOnlyStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
      if (mmddyyyyMatch) {
        const [, month, day, year] = mmddyyyyMatch
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
        if (!isNaN(date.getTime())) {
          date.setHours(0, 0, 0, 0)
          return date
        }
      }

      // Try Excel date serial number (days since 1900-01-01)
      const excelSerial = parseFloat(dateStr)
      if (!isNaN(excelSerial) && excelSerial > 0) {
        // Excel epoch is 1900-01-01, but Excel incorrectly treats 1900 as a leap year
        const excelEpoch = new Date(1899, 11, 30) // December 30, 1899
        const date = new Date(excelEpoch.getTime() + excelSerial * 24 * 60 * 60 * 1000)
        if (!isNaN(date.getTime())) {
          // Set time to midnight to ensure only date is stored
          date.setHours(0, 0, 0, 0)
          return date
        }
      }

      return null
    }

    for (const row of data) {
      const rowData = row as any
      const phone = String(rowData[phoneColumn] || '').trim()
      const channelOrderNumber = String(rowData[channelOrderNumberColumn] || '').trim()
      const waybillNumber = String(rowData[trackingIdColumn] || '').trim()
      const channelOrderDate = channelOrderDateColumn ? parseDate(rowData[channelOrderDateColumn]) : null
      const deliveredDate = deliveredDateColumn ? parseDate(rowData[deliveredDateColumn]) : null
      const pickupWarehouse = String(rowData[pickupWarehouseColumn] || '').trim()
      const vendor = vendorColumn ? String(rowData[vendorColumn] || '').trim() || null : null

      // Skip empty rows
      if (!phone || !channelOrderNumber || !waybillNumber || !pickupWarehouse) {
        continue
      }

      // Normalize phone number (remove spaces, dashes, etc.)
      const normalizedPhone = phone.replace(/[\s\-\(\)]/g, '')

      records.push({
        consigneeContact: normalizedPhone,
        channelOrderNumber,
        waybillNumber,
        channelOrderDate,
        deliveredDate,
        pickupWarehouse,
        vendor,
      })
    }

    if (records.length === 0) {
      return NextResponse.json(
        { error: 'No valid records found in the sheet' },
        { status: 400 }
      )
    }

    // Check if model exists (in case Prisma client wasn't regenerated)
    if (!prisma.orderTrackingData) {
      console.error('OrderTrackingData model not found in Prisma client. Please restart the server after running: npx prisma generate')
      return NextResponse.json(
        { error: 'Order tracking service not available. Please restart the server and try again.' },
        { status: 503 }
      )
    }

    // Insert or update records in database
    let inserted = 0
    let updated = 0
    let skipped = 0

    for (const record of records) {
      try {
        // Try to find existing record (using findFirst since unique constraint was removed for nullable)
        // Include storeId in the search to ensure we match records from the same store
        const existing = await prisma.orderTrackingData.findFirst({
          where: {
            tenantId, // Filter by tenant
            storeId: storeId || null, // Filter by store (null for tenant-level)
            consigneeContact: record.consigneeContact,
            channelOrderNumber: record.channelOrderNumber,
            waybillNumber: record.waybillNumber,
          },
        })

        if (existing) {
          // Update existing record
          await prisma.orderTrackingData.update({
            where: { id: existing.id },
            data: {
              channelOrderDate: record.channelOrderDate || existing.channelOrderDate,
              deliveredDate: record.deliveredDate || existing.deliveredDate,
              pickupWarehouse: record.pickupWarehouse,
              vendor: record.vendor || existing.vendor,
              updatedAt: new Date(),
            },
          })
          updated++
        } else {
          // Insert new record
          await prisma.orderTrackingData.create({
            data: {
              id: crypto.randomUUID(),
              tenantId, // Always include tenantId
              storeId: storeId || null, // Include storeId if provided
              consigneeContact: record.consigneeContact,
              channelOrderNumber: record.channelOrderNumber,
              waybillNumber: record.waybillNumber,
              channelOrderDate: record.channelOrderDate,
              deliveredDate: record.deliveredDate,
              pickupWarehouse: record.pickupWarehouse,
              vendor: record.vendor,
              uploadedBy: session.user.id,
              updatedAt: new Date(),
            },
          })
          inserted++
        }
      } catch (error: any) {
        console.error('Error processing record:', error, record)
        skipped++
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Sheet uploaded and processed successfully',
      stats: {
        total: records.length,
        inserted,
        updated,
        skipped,
      },
    })
  } catch (error: any) {
    console.error('Error uploading order tracking sheet:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to upload sheet' },
      { status: 500 }
    )
  }
}

