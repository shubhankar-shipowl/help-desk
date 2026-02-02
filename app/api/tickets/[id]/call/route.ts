import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from 'crypto';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions);

    // Only agents and admins can initiate calls
    if (
      !session ||
      (session.user.role !== "AGENT" && session.user.role !== "ADMIN")
    ) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const resolvedParams = await Promise.resolve(params);

    // Safety check: ensure ID is provided
    if (!resolvedParams.id || resolvedParams.id === "undefined") {
      return NextResponse.json(
        { error: "Ticket ID is required" },
        { status: 400 }
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
      return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
    }

    // Check if customer has a phone number
    if (!ticket.User_Ticket_customerIdToUser?.phone) {
      return NextResponse.json(
        { error: "Customer phone number is not available" },
        { status: 400 }
      );
    }

    // Get Exotel configuration from environment variables only
    const exotelKey = process.env.EXOTEL_KEY;
    const exotelToken = process.env.EXOTEL_TOKEN;
    const exotelSid = process.env.EXOTEL_SID;
    const callerId = process.env.CALLER_ID;
    const flowUrl = process.env.FLOW_URL;

    if (!exotelKey || !exotelToken || !exotelSid || !callerId) {
      return NextResponse.json(
        {
          error:
            "Exotel configuration is missing. Please check your environment variables (EXOTEL_KEY, EXOTEL_TOKEN, EXOTEL_SID, CALLER_ID).",
        },
        { status: 500 }
      );
    }

    // Get agent's phone number from session user (required for calling)
    // This will be used as the "From" number - Exotel will call this number first
    const agent = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { phone: true, name: true, email: true },
    });

    // Check if agent has configured their phone number
    if (!agent?.phone || agent.phone.trim() === "") {
      return NextResponse.json(
        {
          error:
            "Agent phone number is not configured. Please configure your phone number in settings to make calls.",
        },
        { status: 400 }
      );
    }
    
    console.log('[Exotel Call] Agent phone from profile:', {
      agentId: session.user.id,
      agentName: agent.name,
      agentPhone: agent.phone,
    });

    // For Exotel flow-based calling:
    // From: The agent's phone number (will be called first, then connected to customer)
    // To: The customer's phone number (will be called after agent answers)
    // CallerId: Your Exotel number (appears on customer's phone)
    // Url: The Exotel flow URL that handles the call logic
    // The flow URL should receive the customer phone as a parameter
    
    // Normalize phone numbers (remove spaces, dashes, ensure country code)
    const normalizePhone = (phone: string): string => {
      // Remove all non-digit characters except +
      let normalized = phone.replace(/[^\d+]/g, '');
      // If doesn't start with +, assume it's Indian number and add +91
      if (!normalized.startsWith('+')) {
        // If starts with 0, remove it
        if (normalized.startsWith('0')) {
          normalized = normalized.substring(1);
        }
        // Add +91 for Indian numbers if not already present
        if (normalized.length === 10) {
          normalized = '+91' + normalized;
        } else if (!normalized.startsWith('+')) {
          normalized = '+91' + normalized;
        }
      }
      return normalized;
    };

    // Normalize phone numbers
    // From: Agent's saved phone number (will be called first)
    // To: Customer's phone number from ticket (will be called after agent answers)
    const agentPhone = normalizePhone(agent.phone.trim());
    const customerPhone = normalizePhone(ticket.User_Ticket_customerIdToUser.phone.trim());
    
    console.log('[Exotel Call] Phone numbers:', {
      from: agentPhone, // Agent's saved number
      to: customerPhone, // Customer's number from ticket
      ticketId: ticket.id,
      customerName: ticket.User_Ticket_customerIdToUser.name,
    });

    // Get webhook URL for status callbacks
    // Priority: SERVER_URL > NEXT_PUBLIC_APP_URL > APP_URL > NEXTAUTH_URL > VERCEL_URL > localhost
    const serverUrl = process.env.SERVER_URL ||
      process.env.NEXT_PUBLIC_APP_URL || 
      process.env.APP_URL ||
      process.env.NEXTAUTH_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      'http://localhost:3002';
    
    const cleanServerUrl = serverUrl.replace(/\/$/, '');
    const statusCallbackUrl = `${cleanServerUrl}/api/exotel/status-callback`;
    
    // Based on working Exotel flow documentation:
    // Exotel automatically bridges calls when you provide From and To
    // The Url parameter is optional - only needed for custom XML flows
    // If FLOW_URL is set, we'll use it; otherwise Exotel handles automatic bridging
    
    console.log('[Exotel Call] Initiating call:', {
      agentPhone,
      customerPhone,
      callerId,
      statusCallbackUrl,
      flowUrl: flowUrl || 'Not set (Exotel will auto-bridge)',
    });

    // Prepare Exotel API request URL (without credentials in URL)
    const exotelApiUrl = `https://api.exotel.com/v1/Accounts/${exotelSid}/Calls/connect`;

    // Create Basic Auth header
    const credentials = Buffer.from(`${exotelKey}:${exotelToken}`).toString(
      "base64"
    );

    // Create form data for Exotel API
    // Based on working Exotel flow documentation:
    // - From: Agent's number (will be called first)
    // - To: Customer's number (will be called after agent answers)
    // - CallerId: Your Exotel number (appears on customer's phone)
    // - Url: Webhook URL that returns XML to dial customer (REQUIRED)
    // - StatusCallback: Webhook URL for call status updates (optional)
    const formData = new URLSearchParams();
    formData.append("From", agentPhone); // Agent number (called first)
    formData.append("To", customerPhone); // Customer number (for reference)
    formData.append("CallerId", callerId); // Your Exotel number
    
    // Url parameter is REQUIRED - Exotel calls this when agent answers
    // This webhook returns XML that tells Exotel to dial the customer
    // NOTE: Exotel internal flow URLs (my.exotel.com/exoml) don't support query parameters
    // So we ALWAYS use our custom webhook which handles the customer phone correctly
    let urlToUse: string;
    if (flowUrl && flowUrl.trim() !== '' && !flowUrl.includes('my.exotel.com/exoml')) {
      // Custom webhook URL (for call flow control via XML) - NOT an Exotel internal flow
      urlToUse = flowUrl.includes('?') 
        ? `${flowUrl}&customer_phone=${encodeURIComponent(customerPhone)}`
        : `${flowUrl}?customer_phone=${encodeURIComponent(customerPhone)}`;
      console.log('[Exotel Call] Using custom flow URL:', urlToUse);
    } else {
      // Use our webhook endpoint (default, or when FLOW_URL is an Exotel internal flow)
      // Our webhook returns XML that dials the customer phone
      const webhookUrl = `${cleanServerUrl}/api/exotel/webhook?customer_phone=${encodeURIComponent(customerPhone)}`;
      urlToUse = webhookUrl;
      if (flowUrl && flowUrl.includes('my.exotel.com/exoml')) {
        console.log('[Exotel Call] Ignoring Exotel flow URL (not supported with query params), using webhook:', urlToUse);
      } else {
        console.log('[Exotel Call] Using default webhook URL:', urlToUse);
      }
    }
    formData.append("Url", urlToUse);
    
    // Use StatusCallback for webhook notifications (optional)
    formData.append("StatusCallback", statusCallbackUrl);
    formData.append("StatusCallbackContentType", "application/json");
    
    // Optional parameters
    formData.append("CallType", "trans"); // Transactional call
    formData.append("TimeLimit", "3600"); // 1 hour max call duration
    formData.append("TimeOut", "30"); // 30 seconds timeout for agent to answer
    
    // Recording parameters (some Exotel accounts might not support these)
    // Comment out if they cause errors
    // formData.append("Record", "true"); // Enable recording
    // formData.append("RecordingChannels", "dual"); // Separate channels for caller/callee
    
    // Add custom field for tracking (Exotel supports multiple CustomField parameters)
    formData.append("CustomField", `ticket_id:${ticket.id}`);
    formData.append("CustomField", `agent_id:${session.user.id}`);
    
    console.log('[Exotel Call] Request parameters:', {
      From: agentPhone,
      To: customerPhone,
      CallerId: callerId,
      Url: urlToUse,
      StatusCallback: statusCallbackUrl,
      CallType: "trans",
      TimeLimit: "3600",
      TimeOut: "30",
    });

    // Make request to Exotel API with Basic Authentication
    const response = await fetch(exotelApiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${credentials}`,
      },
      body: formData.toString(),
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error("Exotel API Error:", responseText);
      return NextResponse.json(
        { error: "Failed to initiate call via Exotel", details: responseText },
        { status: response.status }
      );
    }

    // Parse Exotel response (usually XML)
    let callData: any = {};
    let exotelCallId: string | null = null;
    
    try {
      // Try to extract call ID from Exotel response (usually in XML format)
      // Exotel response format: <Response><Call><Sid>call-sid-here</Sid></Call></Response>
      const callIdMatch = responseText.match(/<Sid>([^<]+)<\/Sid>/i) || 
                         responseText.match(/CallSid["\s]*[:=]["\s]*([^"}\s]+)/i);
      if (callIdMatch && callIdMatch[1]) {
        exotelCallId = callIdMatch[1].trim();
      }
      
      callData = {
        success: true,
        response: responseText,
        callId: exotelCallId,
      };
    } catch (parseError) {
      callData = {
        success: true,
        response: responseText,
      };
    }

    // Create call log entry
    let callLogId: string | null = null;
    try {
      // Check if there's an existing call log for this ticket and agent (for attempts tracking)
      const existingCall = await prisma.callLog.findFirst({
        where: {
          ticketId: ticket.id,
          agentId: session.user.id,
          customerPhone: customerPhone,
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
          customerName: ticket.User_Ticket_customerIdToUser.name || ticket.User_Ticket_customerIdToUser.email || 'Unknown',
          updatedAt: new Date(),
          customerPhone: customerPhone,
          agentPhone: agentPhone,
          status: 'INITIATED',
          duration: 0,
          attempts: attempts,
          exotelCallId: exotelCallId,
          exotelResponse: responseText ? JSON.parse(JSON.stringify({ raw: responseText })) : null,
          remark: null,
        },
      });
      callLogId = callLog.id;
    } catch (callLogError) {
      // Don't fail the request if call log creation fails
      console.error("Error creating call log:", callLogError);
    }

    // Log the call activity
    try {
      await prisma.ticketActivity.create({
        data: {
          id: crypto.randomUUID(),
          ticketId: ticket.id,
          userId: session.user.id,
          action: "call_initiated",
          description: `Call initiated to customer ${ticket.User_Ticket_customerIdToUser.phone}`,
          metadata: {
            customerPhone: ticket.User_Ticket_customerIdToUser.phone,
            callerId: callerId,
            exotelResponse: responseText,
            callLogId: callLogId,
          },
        },
      });
    } catch (activityError) {
      // Don't fail the request if activity logging fails
      console.error("Error logging call activity:", activityError);
    }

    return NextResponse.json({
      success: true,
      message: "Call initiated successfully",
      call: callData,
    });
  } catch (error: any) {
    console.error("Error initiating call:", error);
    return NextResponse.json(
      { error: error.message || "Failed to initiate call" },
      { status: 500 }
    );
  }
}
