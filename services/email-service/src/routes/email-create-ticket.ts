import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import { uploadFileToMega } from '../services/mega-storage';
import { callAutoAssignTicket, callSendAcknowledgment } from '../services/monolith-client';
import { randomUUID } from 'crypto';

export const emailCreateTicketRouter = Router();

function generateTicketNumber(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}${day}`;
  const sequence = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `TKT-${dateStr}-${sequence}`;
}

emailCreateTicketRouter.post('/:id/create-ticket', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

    const { name, email: customerEmail, phone, order, trackingId, subject, description, categoryId, priority, assignedAgentId } = req.body;

    if (!name || !customerEmail || !phone || !order || !trackingId || !subject || !description) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const emailRecord = await prisma.email.findUnique({
      where: { id: req.params.id },
      include: { EmailAttachment: true },
    });

    if (!emailRecord) return res.status(404).json({ error: 'Email not found' });

    if (emailRecord.ticketId) {
      const existingTicket = await prisma.ticket.findUnique({
        where: { id: emailRecord.ticketId },
      });

      if (existingTicket) {
        return res.status(400).json({ error: 'Email is already linked to a ticket', ticketId: emailRecord.ticketId });
      } else {
        await prisma.email.update({
          where: { id: emailRecord.id },
          data: { ticketId: null },
        });
      }
    }

    const storeId = emailRecord.storeId || null;

    // Find or create customer
    let customer = await prisma.user.findFirst({
      where: { email: customerEmail, tenantId, role: 'CUSTOMER' },
    });

    if (!customer) {
      const now = new Date();
      customer = await prisma.user.create({
        data: {
          id: randomUUID(),
          email: customerEmail,
          name: name.trim(),
          phone: phone.trim(),
          role: 'CUSTOMER',
          tenantId,
          storeId,
          createdAt: now,
          updatedAt: now,
        },
      });
    } else {
      await prisma.user.update({
        where: { id: customer.id },
        data: { name: name.trim(), phone: phone.trim() },
      });
    }

    const ticketNumber = generateTicketNumber();
    const now = new Date();

    const ticket = await prisma.ticket.create({
      data: {
        id: randomUUID(),
        ticketNumber,
        tenantId,
        storeId,
        customerId: customer.id,
        subject: subject.trim(),
        description: description.trim(),
        categoryId: categoryId || null,
        priority: (priority || 'NORMAL') as any,
        assignedAgentId: assignedAgentId || null,
        status: 'NEW',
        source: 'EMAIL',
        createdAt: now,
        updatedAt: now,
      },
    });

    // Update description with order info
    const orderInfo = `Order ID: ${order}\nTracking ID: ${trackingId}`;
    const fullDescription = `${description.trim()}\n\n---\n${orderInfo}`;
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { description: fullDescription },
    });

    // Link email to ticket
    await prisma.email.update({
      where: { id: emailRecord.id },
      data: { ticketId: ticket.id },
    });

    // Store original email Message-ID for threading
    if (emailRecord.messageId) {
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { originalEmailMessageId: emailRecord.messageId },
      });
    }

    // Copy email attachments to ticket
    if (emailRecord.EmailAttachment && emailRecord.EmailAttachment.length > 0) {
      for (const attachment of emailRecord.EmailAttachment) {
        try {
          if (attachment.fileUrl) {
            await prisma.attachment.create({
              data: {
                id: randomUUID(),
                ticketId: ticket.id,
                filename: attachment.filename,
                fileUrl: attachment.fileUrl,
                fileSize: attachment.size,
                mimeType: attachment.mimeType,
              },
            });
          }
        } catch (attachError) {
          console.error('Error copying attachment to ticket:', attachError);
        }
      }
    }

    // Auto-assign ticket if no agent specified
    if (!assignedAgentId) {
      await callAutoAssignTicket(ticket.id);
    }

    // Send acknowledgment email as reply to original thread
    await callSendAcknowledgment(ticket.id, { inReplyTo: emailRecord.messageId || undefined });

    // Fetch full ticket with relations
    const fullTicket = await prisma.ticket.findUnique({
      where: { id: ticket.id },
      include: {
        User_Ticket_customerIdToUser: true,
        Category: true,
        User_Ticket_assignedAgentIdToUser: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    const transformedTicket = fullTicket ? {
      ...fullTicket,
      customer: fullTicket.User_Ticket_customerIdToUser || null,
      category: fullTicket.Category || null,
      assignedAgent: fullTicket.User_Ticket_assignedAgentIdToUser || null,
    } : null;

    res.json({ success: true, message: 'Ticket created successfully from email', ticket: transformedTicket });
  } catch (error: any) {
    console.error('Error creating ticket from email:', error);
    res.status(500).json({ error: error.message || 'Failed to create ticket from email' });
  }
});
