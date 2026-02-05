import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { initiateExotelCall } from '@/lib/exotel-call-service';
import crypto from 'crypto';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const session = await getServerSession(authOptions);

    // Only agents and admins can initiate calls
    if (
      !session ||
      (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')
    ) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(params);

    // Safety check: ensure ID is provided
    if (!resolvedParams.id || resolvedParams.id === 'undefined') {
      return NextResponse.json(
        { error: 'Ticket ID is required' },
        { status: 400 },
      );
    }

    // Fetch ticket with customer details
    const ticket = await prisma.ticket.findUnique({
      where: { id: resolvedParams.id },
      include: {
        User_Ticket_customerIdToUser: true,
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Check if customer has a phone number
    if (!ticket.User_Ticket_customerIdToUser?.phone) {
      return NextResponse.json(
        { error: 'Customer phone number is not available' },
        { status: 400 },
      );
    }

    // Get Exotel configuration from environment variables
    const exotelKey = process.env.EXOTEL_KEY;
    const exotelToken = process.env.EXOTEL_TOKEN;
    const exotelSid = process.env.EXOTEL_SID;
    const callerId = process.env.CALLER_ID;

    if (!exotelKey || !exotelToken || !exotelSid || !callerId) {
      return NextResponse.json(
        {
          error:
            'Exotel configuration is missing. Please check your environment variables (EXOTEL_KEY, EXOTEL_TOKEN, EXOTEL_SID, CALLER_ID).',
        },
        { status: 500 },
      );
    }

    // Get agent's phone number from session user
    const agent = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phone: true, name: true, email: true },
    });

    // Check if agent has configured their phone number
    if (!agent?.phone || agent.phone.trim() === '') {
      return NextResponse.json(
        {
          error:
            'Agent phone number is not configured. Please configure your phone number in settings to make calls.',
        },
        { status: 400 },
      );
    }

    console.log('[Exotel Call] Initiating call:', {
      agentId: session.user.id,
      agentName: agent.name,
      agentPhone: agent.phone,
      customerId: ticket.customerId,
      customerName: ticket.User_Ticket_customerIdToUser.name,
      customerPhone: ticket.User_Ticket_customerIdToUser.phone,
      ticketId: ticket.id,
    });

    // Get webhook URL for status callbacks
    const serverUrl =
      process.env.SERVER_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.APP_URL ||
      process.env.NEXTAUTH_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      'http://localhost:3002';

    const cleanServerUrl = serverUrl.replace(/\/$/, '');
    const statusCallbackUrl = `${cleanServerUrl}/api/exotel/status-callback`;

    // Use the utility function to initiate the call
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
      return NextResponse.json(
        {
          error: callResult.error || 'Failed to initiate call via Exotel',
          details: callResult.details || callResult.response,
        },
        { status: 400 },
      );
    }

    const exotelCallId = callResult.callSid;

    // Create call log entry
    let callLogId: string | null = null;
    try {
      const existingCall = await prisma.callLog.findFirst({
        where: {
          ticketId: ticket.id,
          agentId: session.user.id,
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
          agentId: session.user.id,
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

    // Log the call activity
    try {
      await prisma.ticketActivity.create({
        data: {
          id: crypto.randomUUID(),
          ticketId: ticket.id,
          userId: session.user.id,
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

    console.log('[Exotel Call] ✅ Call initiated successfully:', {
      callSid: exotelCallId,
      ticketId: ticket.id,
      callLogId: callLogId,
    });

    return NextResponse.json({
      success: true,
      message: 'Call initiated successfully',
      call: {
        success: true,
        callId: exotelCallId,
      },
    });
  } catch (error: any) {
    console.error('Error initiating call:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to initiate call' },
      { status: 500 },
    );
  }
}
