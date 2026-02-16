import axios from 'axios';
import xml2js from 'xml2js';
import { prisma } from '../config/database';
import { uploadCallRecordingToMega } from './mega-storage';

/**
 * Format phone number to E.164 format for Exotel
 */
export function formatPhoneForExotel(phone: string): string {
  if (!phone) {
    return phone;
  }

  let cleaned = phone.toString().trim().replace(/\s+/g, '');

  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  if (/^0\d{10}$/.test(cleaned)) {
    return `+91${cleaned.substring(1)}`;
  }

  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  if (/^91\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  return phone;
}

/**
 * Map Exotel status to internal CallLog status
 */
export function mapExotelStatus(
  exotelStatus?: string,
  exotelOutcome?: string,
):
  | 'INITIATED'
  | 'RINGING'
  | 'ANSWERED'
  | 'COMPLETED'
  | 'FAILED'
  | 'BUSY'
  | 'NO_ANSWER'
  | 'CANCELLED' {
  const statusMap: Record<
    string,
    | 'INITIATED'
    | 'RINGING'
    | 'ANSWERED'
    | 'COMPLETED'
    | 'FAILED'
    | 'BUSY'
    | 'NO_ANSWER'
    | 'CANCELLED'
  > = {
    completed: 'COMPLETED',
    'no-answer': 'NO_ANSWER',
    no_answer: 'NO_ANSWER',
    busy: 'BUSY',
    failed: 'FAILED',
    canceled: 'CANCELLED',
    cancelled: 'CANCELLED',
    ringing: 'RINGING',
    answered: 'ANSWERED',
    'in-progress': 'ANSWERED',
  };

  const status = (exotelStatus || exotelOutcome || '').toLowerCase();
  return statusMap[status] || 'FAILED';
}

/**
 * Fetch call duration from Exotel API
 */
export async function fetchDurationFromExotel(
  callSid: string,
  exotelConfig: {
    exotelSid: string;
    apiKey: string;
    apiToken: string;
  },
): Promise<number | null> {
  try {
    const { exotelSid, apiKey, apiToken } = exotelConfig;

    if (!exotelSid || !apiKey || !apiToken) {
      console.warn('[Duration Fetch] Missing Exotel credentials');
      return null;
    }

    const apiUrl = `https://${apiKey}:${apiToken}@api.exotel.com/v1/Accounts/${exotelSid}/Calls/${callSid}.json`;

    console.log(`[Duration Fetch] Fetching duration for CallSid: ${callSid}`);

    const response = await axios.get(apiUrl, { timeout: 10000 });

    if (response.data && response.data.Call) {
      const callData = response.data.Call;

      let duration = callData.ConversationDuration || 0;
      if (typeof duration === 'string') {
        duration = parseInt(duration) || 0;
      }

      if (!duration && callData.StartTime && callData.EndTime) {
        const startTime = new Date(callData.StartTime);
        const endTime = new Date(callData.EndTime);
        if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
          duration = Math.floor(
            (endTime.getTime() - startTime.getTime()) / 1000,
          );
        }
      }

      if (!duration) {
        duration = callData.Duration || callData.CallDuration || 0;
      }

      if (duration > 0) {
        return parseInt(duration.toString());
      }
    }

    return null;
  } catch (error: any) {
    console.error(`[Duration Fetch] Failed for ${callSid}:`, error.message);
    return null;
  }
}

/**
 * Retry fetching duration with exponential backoff
 */
export async function retryFetchDuration(
  callSid: string,
  callLogId: string,
  exotelConfig: {
    exotelSid: string;
    apiKey: string;
    apiToken: string;
  },
  delayMs: number = 30000,
  maxRetries: number = 3,
): Promise<boolean> {
  console.log(
    `[Duration Retry] Starting retry sequence for CallSid: ${callSid} (max ${maxRetries} attempts)`,
  );

  for (let retryCount = 1; retryCount <= maxRetries; retryCount++) {
    if (retryCount > 1) {
      const waitTime = delayMs * Math.pow(2, retryCount - 2);
      console.log(
        `[Duration Retry] Attempt ${retryCount}/${maxRetries} - Waiting ${waitTime}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    } else {
      console.log(
        `[Duration Retry] Attempt ${retryCount}/${maxRetries} - Initial wait ${delayMs}ms`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    const duration = await fetchDurationFromExotel(callSid, exotelConfig);

    if (duration && duration > 0) {
      console.log(
        `[Duration Retry] Success! Duration fetched: ${duration}s`,
      );

      try {
        await prisma.callLog.update({
          where: { id: callLogId },
          data: {
            duration: duration,
            updatedAt: new Date(),
          },
        });
        console.log(
          `[Duration Retry] Call log updated with duration: ${duration}s`,
        );
        return true;
      } catch (error) {
        console.error('[Duration Retry] Failed to update call log:', error);
        return false;
      }
    }

    console.log(
      `[Duration Retry] Attempt ${retryCount}/${maxRetries} - No duration available yet`,
    );
  }

  console.log(
    `[Duration Retry] Failed to fetch duration after ${maxRetries} attempts`,
  );
  return false;
}

/**
 * Extract contact/ticket ID from CustomField
 */
export function extractContactId(customField?: string): string | null {
  if (!customField) return null;

  const match = customField.match(/ticket_id:([^\s,]+)/);
  return match ? match[1] : null;
}

/**
 * Process Exotel webhook callback
 */
export async function handleExotelWebhook(
  webhookData: {
    CallSid?: string;
    Status?: string;
    Duration?: string | number;
    RecordingUrl?: string;
    RecordingURL?: string;
    Outcome?: string;
    ConversationDuration?: string | number;
    StartTime?: string;
    EndTime?: string;
    CustomField?: string;
    To?: string;
    From?: string;
  },
  exotelConfig?: {
    exotelSid: string;
    apiKey: string;
    apiToken: string;
  },
): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  callSid?: string;
}> {
  try {
    const {
      CallSid,
      Status,
      Duration,
      RecordingUrl,
      RecordingURL,
      Outcome,
      ConversationDuration,
      CustomField,
    } = webhookData;

    console.log('[Webhook] Processing webhook:', {
      CallSid,
      Status,
      Outcome,
      CustomField,
    });

    if (!CallSid) {
      return {
        success: false,
        error: 'Missing CallSid in webhook',
      };
    }

    const ticketId = extractContactId(CustomField);

    let callLog = await prisma.callLog.findFirst({
      where: {
        exotelCallId: CallSid,
      },
    });

    if (!callLog && ticketId) {
      callLog = await prisma.callLog.findFirst({
        where: {
          ticketId: ticketId,
        },
        orderBy: {
          startedAt: 'desc',
        },
      });
    }

    if (!callLog) {
      console.warn('[Webhook] Call log not found for CallSid:', CallSid);
      return {
        success: false,
        error: 'Call log not found',
        callSid: CallSid,
      };
    }

    const callStatus = mapExotelStatus(Status, Outcome);

    let finalDuration = callLog.duration || 0;

    if (ConversationDuration) {
      finalDuration = parseInt(ConversationDuration.toString()) || 0;
    } else if (Duration) {
      finalDuration = parseInt(Duration.toString()) || 0;
    } else if (webhookData.StartTime && webhookData.EndTime) {
      const startTime = new Date(webhookData.StartTime);
      const endTime = new Date(webhookData.EndTime);
      if (!isNaN(startTime.getTime()) && !isNaN(endTime.getTime())) {
        finalDuration = Math.floor(
          (endTime.getTime() - startTime.getTime()) / 1000,
        );
      }
    }

    const exotelRecordingUrl = RecordingUrl || RecordingURL || null;
    let localRecordingUrl = exotelRecordingUrl;

    if (exotelRecordingUrl && exotelConfig && CallSid) {
      try {
        console.log('[Webhook] Uploading recording to Mega:', CallSid);
        const megaResult = await uploadCallRecordingToMega(
          exotelRecordingUrl,
          CallSid,
          { apiKey: exotelConfig.apiKey, apiToken: exotelConfig.apiToken }
        );
        if (megaResult) {
          localRecordingUrl = megaResult.fileUrl;
          console.log('[Webhook] Recording uploaded to Mega:', localRecordingUrl);
        }
      } catch (megaError: any) {
        console.error('[Webhook] Failed to upload recording to Mega:', megaError.message);
      }
    }

    await prisma.callLog.update({
      where: { id: callLog.id },
      data: {
        status: callStatus,
        duration: finalDuration,
        remark: Outcome || null,
        recordingUrl: localRecordingUrl,
        exotelResponse: JSON.stringify(webhookData),
        endedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    console.log('[Webhook] Call log updated:', {
      callLogId: callLog.id,
      status: callStatus,
      duration: finalDuration,
    });

    if (
      callStatus === 'COMPLETED' &&
      (!finalDuration || finalDuration === 0) &&
      exotelConfig
    ) {
      console.log('[Webhook] Scheduling duration retry for:', CallSid);
      retryFetchDuration(CallSid, callLog.id, exotelConfig, 30000, 3).catch(
        (err) => console.error('[Webhook] Retry failed:', err),
      );
    }

    return {
      success: true,
      message: 'Webhook processed successfully',
      callSid: CallSid,
    };
  } catch (error: any) {
    console.error('[Webhook] Error processing webhook:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Initiate a call via Exotel
 */
export async function initiateExotelCall(config: {
  exotelSid: string;
  apiKey: string;
  apiToken: string;
  agentNumber: string;
  customerNumber: string;
  callerId: string;
  statusCallback?: string;
  customField?: string;
  timeLimit?: number;
  timeOut?: number;
  record?: boolean;
  recordingChannels?: string;
  flowUrl?: string;
}): Promise<{
  success: boolean;
  callSid?: string;
  error?: string;
  response?: any;
  details?: any;
}> {
  try {
    const {
      exotelSid,
      apiKey,
      apiToken,
      agentNumber,
      customerNumber,
      callerId,
      statusCallback,
      customField,
      timeLimit = 3600,
      timeOut = 30,
      record = true,
      recordingChannels = 'dual',
      flowUrl,
    } = config;

    const required: Record<string, any> = {
      exotelSid,
      apiKey,
      apiToken,
      agentNumber,
      customerNumber,
      callerId,
    };

    const missingKeys = Object.keys(required).filter((key) => !required[key]);
    if (missingKeys.length > 0) {
      return {
        success: false,
        error: `Missing required parameters: ${missingKeys.join(', ')}`,
        details: { missing: missingKeys },
      };
    }

    console.log('[Call Initiation] Starting call:', {
      agent: agentNumber,
      customer: customerNumber,
    });

    const formattedAgentNumber = formatPhoneForExotel(agentNumber);
    const formattedCustomerNumber = formatPhoneForExotel(customerNumber);

    const exotelApiUrl = `https://${apiKey}:${apiToken}@api.exotel.com/v1/Accounts/${exotelSid}/Calls/connect`;

    const params = new URLSearchParams({
      From: formattedAgentNumber,
      To: formattedCustomerNumber,
      CallerId: callerId,
      TimeLimit: timeLimit.toString(),
      TimeOut: timeOut.toString(),
      Record: record ? 'true' : 'false',
      RecordingChannels: recordingChannels,
    });

    if (statusCallback) {
      params.append('StatusCallback', statusCallback);
    }

    if (customField) {
      params.append('CustomField', customField);
    }

    if (flowUrl) {
      params.append('Url', flowUrl);
    }

    const response = await axios.post(exotelApiUrl, params, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 15000,
    });

    const parser = new xml2js.Parser();
    const parsedResponse = await parser.parseStringPromise(response.data);

    const callSid = parsedResponse?.TwilioResponse?.Call?.[0]?.Sid?.[0];
    const status = parsedResponse?.TwilioResponse?.Call?.[0]?.Status?.[0];

    if (!callSid) {
      return {
        success: false,
        error: 'No CallSid received from Exotel API',
        response: parsedResponse,
      };
    }

    console.log('[Call Initiation] Call initiated successfully:', {
      callSid,
      status,
    });

    return {
      success: true,
      callSid: callSid,
      response: parsedResponse,
    };
  } catch (error: any) {
    let errorMessage = error.message || 'Failed to initiate call';
    let errorDetails: any = {
      message: error.message,
      code: error.code,
    };

    if (error.response) {
      console.error('[Call Initiation] Exotel API Error:');
      console.error('   Status:', error.response.status);
      console.error('   Data:', typeof error.response.data === 'string'
        ? error.response.data.substring(0, 500)
        : JSON.stringify(error.response.data));

      errorDetails.status = error.response.status;
      errorDetails.responseData = error.response.data;

      if (typeof error.response.data === 'string' && error.response.data.includes('RestException')) {
        try {
          const parser = new xml2js.Parser();
          const parsed = await parser.parseStringPromise(error.response.data);
          const restException = parsed?.TwilioResponse?.RestException?.[0];
          if (restException) {
            errorMessage = restException.Message?.[0] || errorMessage;
            errorDetails.exotelCode = restException.Code?.[0];
            errorDetails.exotelMessage = restException.Message?.[0];
          }
        } catch (parseError) {
          // Ignore parse errors
        }
      }
    } else {
      console.error('[Call Initiation] Error:', error.message);
    }

    return {
      success: false,
      error: errorMessage,
      details: errorDetails,
    };
  }
}
