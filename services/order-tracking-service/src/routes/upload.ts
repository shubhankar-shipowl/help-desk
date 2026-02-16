import { Router, Request, Response } from 'express';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import { prisma } from '../config/database';
import * as XLSX from 'xlsx';
import crypto from 'crypto';

const router = Router();

// POST /order-tracking/upload
router.post('/', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }

    // Express doesn't parse multipart natively; we read the raw body
    // Next.js rewrites forward the multipart form data
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      res.status(400).json({ error: 'Content-Type must be multipart/form-data' });
      return;
    }

    // Collect raw body chunks
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    const rawBody = Buffer.concat(chunks);

    // Parse multipart boundary
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (!boundaryMatch) {
      res.status(400).json({ error: 'Invalid multipart boundary' });
      return;
    }

    const boundary = boundaryMatch[1].replace(/^["']|["']$/g, '');
    const parts = parseMultipart(rawBody, boundary);

    const filePart = parts.find(p => p.name === 'file');
    const storeIdPart = parts.find(p => p.name === 'storeId');
    const storeId = storeIdPart?.value || null;

    if (req.user!.role === 'ADMIN' && !storeId) {
      res.status(400).json({ error: 'Store ID is required for admin users' });
      return;
    }

    if (storeId) {
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId, isActive: true },
      });
      if (!store) {
        res.status(400).json({ error: 'Invalid store ID or store does not belong to this tenant' });
        return;
      }
    }

    if (!filePart || !filePart.data) {
      res.status(400).json({ error: 'No file provided' });
      return;
    }

    const fileName = (filePart.filename || '').toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls') && !fileName.endsWith('.csv')) {
      res.status(400).json({ error: 'Invalid file type. Please upload Excel (.xlsx, .xls) or CSV (.csv) file' });
      return;
    }

    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(filePart.data, { type: 'buffer' });
    } catch (error: any) {
      res.status(400).json({ error: 'Failed to parse file. Please ensure it is a valid Excel or CSV file.' });
      return;
    }

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { raw: false });

    if (!Array.isArray(data) || data.length === 0) {
      res.status(400).json({ error: 'Sheet is empty or invalid format' });
      return;
    }

    const firstRow = data[0] as any;
    const columns = Object.keys(firstRow);

    const findColumn = (searchTerms: string[]) => {
      for (const term of searchTerms) {
        const found = columns.find(col => col.toLowerCase().trim() === term.toLowerCase().trim());
        if (found) return found;
      }
      return null;
    };

    const phoneColumn = findColumn([
      'Phone Number', 'phone number', 'PhoneNumber', 'phonenumber',
      'Consignee Contact', 'consignee contact', 'ConsigneeContact',
      'Phone', 'phone', 'Contact', 'contact',
    ]);

    const channelOrderNumberColumn = findColumn([
      'Customer Name', 'customer name', 'CustomerName', 'customername',
      'Channel Order Number', 'channel order number', 'ChannelOrderNumber', 'channelordernumber',
      'OrderId', 'Order ID', 'order id', 'OrderID', 'orderid',
    ]);

    const trackingIdColumn = findColumn([
      'AWB Number', 'awb number', 'AWBNumber', 'awbnumber',
      'WayBill Number', 'waybill number', 'WayBillNumber',
      'Tracking ID', 'tracking id', 'TrackingID', 'trackingid',
    ]);

    const channelOrderDateColumn = findColumn([
      'Order Date', 'order date', 'OrderDate', 'orderdate',
      'Channel Order Date', 'channel order date', 'ChannelOrderDate', 'channelorderdate',
    ]);

    const deliveredDateColumn = findColumn([
      'Delivery Date', 'delivery date', 'DeliveryDate', 'deliverydate',
      'Delivered Date', 'delivered date', 'DeliveredDate', 'delivereddate',
    ]);

    const pickupWarehouseColumn = findColumn([
      'Warehouse Name', 'warehouse name', 'WarehouseName', 'warehousename',
      'Pickup Warehouse', 'pickup warehouse', 'PickupWarehouse', 'pickupwarehouse',
      'Warehouse', 'warehouse', 'Pickup Location', 'pickup location', 'PickupLocation', 'pickuplocation',
    ]);

    const vendorColumn = findColumn([
      'Vendor', 'vendor', 'Vendor Name', 'vendor name', 'VendorName', 'vendorname',
      'Seller', 'seller', 'Seller Name', 'seller name',
    ]);

    if (!phoneColumn || !channelOrderNumberColumn || !trackingIdColumn || !pickupWarehouseColumn) {
      res.status(400).json({
        error: 'Required columns not found. Please ensure your sheet contains: Phone Number, Customer Name/Channel Order Number, AWB/WayBill Number, and Warehouse Name/Pickup Warehouse',
        foundColumns: columns,
        missing: { phone: !phoneColumn, channelOrderNumber: !channelOrderNumberColumn, trackingId: !trackingIdColumn, pickupWarehouse: !pickupWarehouseColumn },
      });
      return;
    }

    const parseDate = (dateValue: any): Date | null => {
      if (!dateValue) return null;
      const dateStr = String(dateValue).trim();
      if (!dateStr) return null;

      let dateOnlyStr = dateStr;
      if (dateStr.includes(' ')) dateOnlyStr = dateStr.split(' ')[0];
      if (dateOnlyStr.includes('T')) dateOnlyStr = dateOnlyStr.split('T')[0];

      const parsed = new Date(dateOnlyStr);
      if (!isNaN(parsed.getTime())) { parsed.setHours(0, 0, 0, 0); return parsed; }

      const mmddyyyyMatch = dateOnlyStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (mmddyyyyMatch) {
        const [, month, day, year] = mmddyyyyMatch;
        const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
        if (!isNaN(date.getTime())) { date.setHours(0, 0, 0, 0); return date; }
      }

      const excelSerial = parseFloat(dateStr);
      if (!isNaN(excelSerial) && excelSerial > 0) {
        const excelEpoch = new Date(1899, 11, 30);
        const date = new Date(excelEpoch.getTime() + excelSerial * 24 * 60 * 60 * 1000);
        if (!isNaN(date.getTime())) { date.setHours(0, 0, 0, 0); return date; }
      }

      return null;
    };

    const records: any[] = [];
    for (const row of data) {
      const rowData = row as any;
      const phone = String(rowData[phoneColumn] || '').trim();
      const channelOrderNumber = String(rowData[channelOrderNumberColumn] || '').trim();
      const waybillNumber = String(rowData[trackingIdColumn] || '').trim();
      const channelOrderDate = channelOrderDateColumn ? parseDate(rowData[channelOrderDateColumn]) : null;
      const deliveredDate = deliveredDateColumn ? parseDate(rowData[deliveredDateColumn]) : null;
      const pickupWarehouse = String(rowData[pickupWarehouseColumn] || '').trim();
      const vendor = vendorColumn ? String(rowData[vendorColumn] || '').trim() || null : null;

      if (!phone || !channelOrderNumber || !waybillNumber || !pickupWarehouse) continue;

      records.push({
        consigneeContact: phone.replace(/[\s\-\(\)]/g, ''),
        channelOrderNumber, waybillNumber, channelOrderDate, deliveredDate, pickupWarehouse, vendor,
      });
    }

    if (records.length === 0) {
      res.status(400).json({ error: 'No valid records found in the sheet' });
      return;
    }

    let inserted = 0, updated = 0, skipped = 0;

    for (const record of records) {
      try {
        const existing = await prisma.orderTrackingData.findFirst({
          where: {
            tenantId, storeId: storeId || null,
            consigneeContact: record.consigneeContact,
            channelOrderNumber: record.channelOrderNumber,
            waybillNumber: record.waybillNumber,
          },
        });

        if (existing) {
          await prisma.orderTrackingData.update({
            where: { id: existing.id },
            data: {
              channelOrderDate: record.channelOrderDate || existing.channelOrderDate,
              deliveredDate: record.deliveredDate || existing.deliveredDate,
              pickupWarehouse: record.pickupWarehouse,
              vendor: record.vendor || existing.vendor,
              updatedAt: new Date(),
            },
          });
          updated++;
        } else {
          await prisma.orderTrackingData.create({
            data: {
              id: crypto.randomUUID(), tenantId, storeId: storeId || null,
              consigneeContact: record.consigneeContact,
              channelOrderNumber: record.channelOrderNumber,
              waybillNumber: record.waybillNumber,
              channelOrderDate: record.channelOrderDate,
              deliveredDate: record.deliveredDate,
              pickupWarehouse: record.pickupWarehouse,
              vendor: record.vendor,
              uploadedBy: req.user!.id,
              updatedAt: new Date(),
            },
          });
          inserted++;
        }
      } catch (error: any) {
        console.error('[Upload] Error processing record:', error.message);
        skipped++;
      }
    }

    res.json({ success: true, message: 'Sheet uploaded and processed successfully', stats: { total: records.length, inserted, updated, skipped } });
  } catch (error: any) {
    console.error('[Upload] Error:', error);
    res.status(500).json({ error: error.message || 'Failed to upload sheet' });
  }
});

// Simple multipart parser
interface MultipartPart {
  name: string;
  filename?: string;
  contentType?: string;
  data?: Buffer;
  value?: string;
}

function parseMultipart(body: Buffer, boundary: string): MultipartPart[] {
  const parts: MultipartPart[] = [];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const endBoundary = Buffer.from(`--${boundary}--`);

  let start = body.indexOf(boundaryBuffer) + boundaryBuffer.length;

  while (start < body.length) {
    const nextBoundary = body.indexOf(boundaryBuffer, start);
    if (nextBoundary === -1) break;

    const partData = body.slice(start, nextBoundary);
    const headerEnd = partData.indexOf('\r\n\r\n');
    if (headerEnd === -1) { start = nextBoundary + boundaryBuffer.length; continue; }

    const headerStr = partData.slice(0, headerEnd).toString('utf-8');
    const content = partData.slice(headerEnd + 4, partData.length - 2); // Remove trailing \r\n

    const nameMatch = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);

    if (nameMatch) {
      const part: MultipartPart = { name: nameMatch[1] };
      if (filenameMatch) {
        part.filename = filenameMatch[1];
        part.contentType = ctMatch ? ctMatch[1].trim() : undefined;
        part.data = content;
      } else {
        part.value = content.toString('utf-8').trim();
      }
      parts.push(part);
    }

    start = nextBoundary + boundaryBuffer.length;
    if (body.indexOf(endBoundary, nextBoundary) === nextBoundary) break;
  }

  return parts;
}

export { router as uploadRouter };
