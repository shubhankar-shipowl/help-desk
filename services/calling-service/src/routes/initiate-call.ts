import { Router, Request, Response } from 'express';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import { prisma } from '../config/database';
import { initiateExotelCall } from '../services/exotel-service';
import crypto from 'crypto';

const router = Router();

// POST /calls/initiate/:ticketId
router.post('/:ticketId', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const { ticketId } = req.params;

    if (!ticketId || ticketId === 'undefined') {
      res.status(400).json({ error: 'Ticket ID is required' });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        User_Ticket_customerIdToUser: true,
      },
    });

    if (!ticket) {
      res.status(404).json({ error: 'Ticket not found' });
      return;
    }

    if (!ticket.User_Ticket_customerIdToUser?.phone) {
      res.status(400).json({ error: 'Customer phone number is not available' });
      return;
    }

    const exotelKey = process.env.EXOTEL_KEY;
    const exotelToken = process.env.EXOTEL_TOKEN;
    const exotelSid = process.env.EXOTEL_SID;
    const callerId = process.env.CALLER_ID;

    if (!exotelKey || !exotelToken || !exotelSid || !callerId) {
      res.status(500).json({
        error:
          'Exotel configuration is missing. Please check your environment variables (EXOTEL_KEY, EXOTEL_TOKEN, EXOTEL_SID, CALLER_ID).',
      });
      return;
    }

    const agent = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { phone: true, name: true, email: true },
    });

    if (!agent?.phone || agent.phone.trim() === '') {
      res.status(400).json({
        error:
          'Agent phone number is not configured. Please configure your phone number in settings to make calls.',
      });
      return;
    }

    console.log('[Exotel Call] Initiating call:', {
      agentId: req.user!.id,
      agentName: agent.name,
      agentPhone: agent.phone,
      customerId: ticket.customerId,
      customerName: ticket.User_Ticket_customerIdToUser.name,
      customerPhone: ticket.User_Ticket_customerIdToUser.phone,
      ticketId: ticket.id,
    });

    const serverUrl =
      process.env.SERVER_URL ||
      process.env.APP_URL ||
      'http://localhost:4002';

    const cleanServerUrl = serverUrl.replace(/\/$/, '');
    const statusCallbackUrl = `${cleanServerUrl}/api/exotel/status-callback`;

    const callResult = await initiateExotelCall({
      exotelSid,
      apiKey: exotelKey,
      apiToken: exotelToken,
      agentNumber: agent.phone.trim(),
      customerNumber: ticket.User_Ticket_customerIdToUser.phone.trim(),
      callerId,
      statusCallback: statusCallbackUrl,
      customField: `ticket_id:${ticket.id}`,
      timeLimit: 3600,
      timeOut: 30,
      record: true,
      recordingChannels: 'dual',
    });

    if (!callResult.success) {
      console.error('[Exotel Call] Failed to initiate call:', callResult);
      res.status(400).json({
        error: callResult.error || 'Failed to initiate call via Exotel',
        details: callResult.details || callResult.response,
      });
      return;
    }

    const exotelCallId = callResult.callSid;

    let callLogId: string | null = null;
    try {
      const existingCall = await prisma.callLog.findFirst({
        where: {
          ticketId: ticket.id,
          agentId: req.user!.id,
          customerPhone: ticket.User_Ticket_customerIdToUser.phone,
        },
        orderBy: {
          startedAt: 'desc',
        },
      });

      const attempts = existingCall ? existingCall.attempts + 1 : 1;

      const callLog = await prisma.callLog.create({
        data: {
          id: crypto.randomUUID(),
          ticketId: ticket.id,
          agentId: req.user!.id,
          customerName:
            ticket.User_Ticket_customerIdToUser.name ||
            ticket.User_Ticket_customerIdToUser.email ||
            'Unknown',
          updatedAt: new Date(),
          customerPhone: ticket.User_Ticket_customerIdToUser.phone,
          agentPhone: agent.phone,
          status: 'INITIATED',
          duration: 0,
          attempts: attempts,
          exotelCallId: exotelCallId,
          exotelResponse: JSON.parse(JSON.stringify({ callSid: exotelCallId })),
          remark: null,
        },
      });
      callLogId = callLog.id;
    } catch (callLogError) {
      console.error('Error creating call log:', callLogError);
    }

    try {
      await prisma.ticketActivity.create({
        data: {
          id: crypto.randomUUID(),
          ticketId: ticket.id,
          userId: req.user!.id,
          action: 'call_initiated',
          description: `Call initiated to customer ${ticket.User_Ticket_customerIdToUser.phone}`,
          metadata: {
            customerPhone: ticket.User_Ticket_customerIdToUser.phone,
            agentPhone: agent.phone,
            callerId: callerId,
            exotelCallSid: exotelCallId,
            callLogId: callLogId,
          },
        },
      });
    } catch (activityError) {
      console.error('Error logging call activity:', activityError);
    }

    console.log('[Exotel Call] Call initiated successfully:', {
      callSid: exotelCallId,
      ticketId: ticket.id,
      callLogId: callLogId,
    });

    res.json({
      success: true,
      message: 'Call initiated successfully',
      call: {
        success: true,
        callId: exotelCallId,
      },
    });
  } catch (error: any) {
    console.error('Error initiating call:', error);
    res.status(500).json({ error: error.message || 'Failed to initiate call' });
  }
});

export { router as initiateCallRouter };
