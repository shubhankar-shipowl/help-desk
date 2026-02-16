import { Router, Request, Response } from 'express';
import { internalAuthMiddleware } from '../middleware/internal-auth';
import { prisma } from '../config/database';
import { ticketNotificationTriggers } from '../services/trigger-handlers';
import { notificationService } from '../services/notification-service';
import { emitToAgents, emitToAdmins, emitToUser } from '../services/websocket';

const router = Router();

// All internal routes require INTERNAL_API_KEY
router.use(internalAuthMiddleware);

// POST /internal/trigger/ticket-created
router.post('/trigger/ticket-created', async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.body;

    if (!ticketId) {
      res.status(400).json({ error: 'ticketId is required' });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        User_Ticket_customerIdToUser: true,
        Category: true,
        User_Ticket_assignedAgentIdToUser: true,
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    await ticketNotificationTriggers.onTicketCreated(ticket);

    // Emit ticket:created event via WebSocket for real-time ticket list updates
    try {
      const ticketForEvent = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
          User_Ticket_customerIdToUser: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          Category: true,
          User_Ticket_assignedAgentIdToUser: {
            select: { id: true, name: true, email: true, avatar: true },
          },
          _count: {
            select: { Comment: true, Attachment: true },
          },
        },
      });

      if (ticketForEvent) {
        const serializedTicket = {
          ...ticketForEvent,
          refundAmount: ticketForEvent.refundAmount ? parseFloat(ticketForEvent.refundAmount.toString()) : null,
        };
        const eventData = { ticket: serializedTicket };
        emitToAgents('ticket:created', eventData);
        emitToAdmins('ticket:created', eventData);
      }
    } catch (wsError) {
      console.error('[Triggers] Error emitting ticket:created via WebSocket:', wsError);
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Triggers] Error on ticket-created:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger ticket-created notification' });
  }
});

// POST /internal/trigger/ticket-assigned
router.post('/trigger/ticket-assigned', async (req: Request, res: Response) => {
  try {
    const { ticketId, assignedById } = req.body;

    if (!ticketId) {
      res.status(400).json({ error: 'ticketId is required' });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        User_Ticket_customerIdToUser: true,
        Category: true,
        User_Ticket_assignedAgentIdToUser: true,
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    let assignedBy = null;
    if (assignedById) {
      assignedBy = await prisma.user.findUnique({
        where: { id: assignedById },
        select: { id: true, name: true, email: true, role: true },
      });
    }

    await ticketNotificationTriggers.onTicketAssigned(ticket, assignedBy);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Triggers] Error on ticket-assigned:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger ticket-assigned notification' });
  }
});

// POST /internal/trigger/new-reply
router.post('/trigger/new-reply', async (req: Request, res: Response) => {
  try {
    const { ticketId, commentId } = req.body;

    if (!ticketId || !commentId) {
      res.status(400).json({ error: 'ticketId and commentId are required' });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        User_Ticket_customerIdToUser: true,
        User_Ticket_assignedAgentIdToUser: true,
        Category: true,
        Email: true,
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      include: { User: true },
    });

    if (!comment) {
      res.status(404).json({ error: 'Comment not found' });
      return;
    }

    await ticketNotificationTriggers.onNewReply(comment, ticket);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Triggers] Error on new-reply:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger new-reply notification' });
  }
});

// POST /internal/trigger/status-changed
router.post('/trigger/status-changed', async (req: Request, res: Response) => {
  try {
    const { ticketId, oldStatus, changedById } = req.body;

    if (!ticketId || !oldStatus) {
      res.status(400).json({ error: 'ticketId and oldStatus are required' });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        User_Ticket_customerIdToUser: true,
        Category: true,
        User_Ticket_assignedAgentIdToUser: true,
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    let changedBy = null;
    if (changedById) {
      changedBy = await prisma.user.findUnique({
        where: { id: changedById },
        select: { id: true, name: true, email: true, role: true },
      });
    }

    await ticketNotificationTriggers.onStatusChanged(ticket, oldStatus, changedBy);

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Triggers] Error on status-changed:', error);
    res.status(500).json({ error: error.message || 'Failed to trigger status-changed notification' });
  }
});

// POST /internal/create-notification - Generic notification creation
router.post('/create-notification', async (req: Request, res: Response) => {
  try {
    const { type, title, message, userId, ticketId, actorId, metadata, channels } = req.body;

    if (!type || !title || !message || !userId) {
      res.status(400).json({ error: 'type, title, message, and userId are required' });
      return;
    }

    await notificationService.createNotification({
      type,
      title,
      message,
      userId,
      ticketId,
      actorId,
      metadata,
      channels,
    });

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Triggers] Error creating notification:', error);
    res.status(500).json({ error: error.message || 'Failed to create notification' });
  }
});

// POST /internal/emit-event - Generic WebSocket event emission
// Allows frontend API routes to emit events to connected WebSocket clients
router.post('/emit-event', async (req: Request, res: Response) => {
  try {
    const { event, data, rooms } = req.body;

    if (!event) {
      res.status(400).json({ error: 'event is required' });
      return;
    }

    if (!rooms || !Array.isArray(rooms) || rooms.length === 0) {
      res.status(400).json({ error: 'rooms array is required (e.g. ["agents", "admins", "user:123"])' });
      return;
    }

    for (const room of rooms) {
      if (room === 'agents') {
        emitToAgents(event, data);
      } else if (room === 'admins') {
        emitToAdmins(event, data);
      } else if (room.startsWith('user:')) {
        const userId = room.substring(5);
        emitToUser(userId, event, data);
      }
    }

    res.json({ success: true });
  } catch (error: any) {
    console.error('[Triggers] Error emitting event:', error);
    res.status(500).json({ error: error.message || 'Failed to emit event' });
  }
});

export { router as triggersRouter };
