import { Router, Request, Response } from 'express';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import { prisma } from '../config/database';
import { convertFacebookNotificationToTicket } from '../services/facebook-converter';
import { createNotification } from '../services/notification-client';
import { Notification_type } from '@prisma/client';

const router = Router();

// POST /facebook/convert-ticket
router.post('/', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const {
      facebookNotificationId,
      assignedAgentId,
      assignedTeamId,
      priority,
      categoryId,
      tags,
      storeId,
    } = req.body;

    if (!facebookNotificationId) {
      res.status(400).json({ error: 'facebookNotificationId is required' });
      return;
    }

    const fbNotification = await prisma.facebookNotification.findUnique({
      where: { id: facebookNotificationId },
      include: { Notification: true },
    });

    if (!fbNotification) {
      res.status(404).json({ error: 'Facebook notification not found' });
      return;
    }

    if (fbNotification.converted) {
      res.status(400).json({
        error: 'Notification already converted to ticket',
        ticketId: fbNotification.convertedTicketId,
      });
      return;
    }

    const ticket = await convertFacebookNotificationToTicket(facebookNotificationId, {
      assignedAgentId: assignedAgentId || req.user!.id,
      assignedTeamId,
      priority,
      categoryId,
      tags,
      storeId,
    });

    await prisma.notification.update({
      where: { id: fbNotification.notificationId },
      data: {
        metadata: {
          ...(fbNotification.Notification.metadata as any || {}),
          converted: true,
          convertedTicketId: ticket.id,
          convertedTicketNumber: ticket.ticketNumber,
          convertedTicketStatus: ticket.status,
        },
      },
    });

    if (ticket.assignedAgentId && ticket.assignedAgentId !== req.user!.id) {
      try {
        await createNotification({
          type: Notification_type.TICKET_ASSIGNED,
          title: 'New Ticket Assigned',
          message: `Ticket ${ticket.ticketNumber} has been assigned to you`,
          userId: ticket.assignedAgentId,
          ticketId: ticket.id,
          metadata: {
            ticketNumber: ticket.ticketNumber,
            subject: ticket.subject,
            source: 'FACEBOOK',
          },
        });
      } catch (notifError: any) {
        console.error('[Convert Ticket] Failed to send assignment notification:', notifError.message);
      }
    }

    res.json({
      success: true,
      ticket: {
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        source: ticket.source,
      },
    });
  } catch (error: any) {
    console.error('Error converting Facebook notification to ticket:', error);
    res.status(500).json({ error: error.message || 'Failed to convert notification to ticket' });
  }
});

// GET /facebook/convert-ticket
router.get('/', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const facebookNotificationId = req.query.facebookNotificationId as string | undefined;

    if (!facebookNotificationId) {
      res.status(400).json({ error: 'facebookNotificationId is required' });
      return;
    }

    const fbNotification = await prisma.facebookNotification.findUnique({
      where: { id: facebookNotificationId },
      include: {
        Ticket: {
          select: {
            id: true,
            ticketNumber: true,
            subject: true,
            status: true,
            priority: true,
          },
        },
      },
    });

    if (!fbNotification) {
      res.status(404).json({ error: 'Facebook notification not found' });
      return;
    }

    res.json({
      converted: fbNotification.converted,
      ticket: fbNotification.Ticket,
    });
  } catch (error: any) {
    console.error('Error checking conversion status:', error);
    res.status(500).json({ error: error.message || 'Failed to check conversion status' });
  }
});

export { router as convertTicketRouter };
