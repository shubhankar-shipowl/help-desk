import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

/**
 * Exotel Status Callback Webhook
 * 
 * This endpoint receives call status updates from Exotel.
 * Based on the working Exotel flow documentation.
 * 
 * Flow:
 * 1. Exotel calls agent (From number)
 * 2. Exotel calls customer (To number) after agent answers
 * 3. Exotel sends status updates to this webhook
 * 4. We update the call log and ticket status
 * 
 * IMPORTANT: This endpoint must be publicly accessible (no authentication required)
 */
export async function POST(req: NextRequest) {
  try {
    console.log('[Exotel Status Callback] Request received');
    
    // Exotel sends JSON data
    const body = await req.json().catch(async () => {
      // Fallback to form data if JSON parsing fails
      const formData = await req.formData();
      const data: any = {};
      for (const [key, value] of formData.entries()) {
        data[key] = value.toString();
      }
      return data;
    });
    
    const {
      CallSid,
      Status,
      Duration,
      ConversationDuration,
      RecordingUrl,
      Outcome,
      To,
      From,
      StartTime,
      EndTime,
      CustomField,
    } = body;
    
    console.log('[Exotel Status Callback] Call status update:', {
      CallSid,
      Status,
      Duration,
      ConversationDuration,
      RecordingUrl,
      Outcome,
      To,
      From,
      StartTime,
      EndTime,
      CustomField,
    });
    
    if (!CallSid) {
      console.error('[Exotel Status Callback] CallSid missing');
      return NextResponse.json({ error: 'CallSid required' }, { status: 400 });
    }
    
    // Extract ticket ID from CustomField
    let ticketId: string | null = null;
    if (CustomField) {
      const ticketMatch = CustomField.match(/ticket_id:([^\s,]+)/);
      if (ticketMatch) {
        ticketId = ticketMatch[1];
      }
    }
    
    // Find call log by exotelCallId
    const callLog = await prisma.callLog.findFirst({
      where: {
        exotelCallId: CallSid,
      },
      include: {
        Ticket: true,
      },
    });
    
    if (!callLog && ticketId) {
      // Try to find by ticket ID if call log not found
      const ticket = await prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
          User_Ticket_customerIdToUser: true,
        },
      });
      
      if (ticket) {
        console.log('[Exotel Status Callback] Found ticket, creating call log');
        // Create call log if it doesn't exist
        await prisma.callLog.create({
          data: {
            id: crypto.randomUUID(),
            ticketId: ticket.id,
            agentId: ticket.assignedAgentId || '', // Will need to get from custom field
            customerName: ticket.User_Ticket_customerIdToUser?.name || 'Unknown',
            customerPhone: To || '',
            agentPhone: From || '',
            status: 'INITIATED',
            exotelCallId: CallSid,
            exotelResponse: body,
            updatedAt: new Date(),
          },
        });
      }
    }
    
    // Map Exotel status to our CallStatus enum
    let callStatus: 'INITIATED' | 'RINGING' | 'ANSWERED' | 'COMPLETED' | 'FAILED' | 'BUSY' | 'NO_ANSWER' | 'CANCELLED' = 'INITIATED';
    
    switch (Status?.toLowerCase()) {
      case 'completed':
        callStatus = 'COMPLETED';
        break;
      case 'no-answer':
      case 'no_answer':
        callStatus = 'NO_ANSWER';
        break;
      case 'busy':
        callStatus = 'BUSY';
        break;
      case 'failed':
        callStatus = 'FAILED';
        break;
      case 'canceled':
      case 'cancelled':
        callStatus = 'CANCELLED';
        break;
      case 'ringing':
        callStatus = 'RINGING';
        break;
      case 'answered':
      case 'in-progress':
        callStatus = 'ANSWERED';
        break;
      default:
        callStatus = 'INITIATED';
    }
    
    // Get duration (prefer ConversationDuration for actual talk time)
    const duration = ConversationDuration 
      ? parseInt(ConversationDuration, 10) 
      : (Duration ? parseInt(Duration, 10) : 0);
    
    // Update call log
    if (callLog) {
      await prisma.callLog.update({
        where: { id: callLog.id },
        data: {
          status: callStatus,
          duration: duration,
          remark: Outcome || null,
          exotelResponse: body,
          endedAt: EndTime ? new Date(EndTime) : (callStatus === 'COMPLETED' ? new Date() : null),
        },
      });
      
      console.log('[Exotel Status Callback] Updated call log:', {
        callLogId: callLog.id,
        status: callStatus,
        duration,
      });
    }
    
    // Update ticket if call is completed
    if (callLog?.ticketId && callStatus === 'COMPLETED') {
      // You can add logic here to update ticket status if needed
      console.log('[Exotel Status Callback] Call completed for ticket:', callLog.ticketId);
    }
    
    return NextResponse.json({ success: true, callSid: CallSid });
  } catch (error: any) {
    console.error('[Exotel Status Callback] Error:', error);
    console.error('[Exotel Status Callback] Error stack:', error.stack);
    
    // Always return 200 to Exotel to prevent retries
    return NextResponse.json({ success: false, error: error.message }, { status: 200 });
  }
}

// Also handle GET requests (some Exotel configurations use GET)
export async function GET(req: NextRequest) {
  return POST(req);
}

