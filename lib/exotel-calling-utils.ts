/**
 * Exotel Calling Utilities - Reusable Code
 *
 * This file contains reusable functions for implementing Exotel calling
 * functionality in any Node.js application.
 *
 * Usage:
 *   import { formatPhoneForExotel, initiateExotelCall, handleExotelWebhook } from './exotel-calling-utils';
 */

import axios from 'axios';
import xml2js from 'xml2js';

/**
 * Format phone number to E.164 format for Exotel
 * Handles various Indian phone number formats
 *
 * @param {string} phone - Phone number in various formats
 * @returns {string} - Formatted phone number in E.164 format (e.g., +919504785931)
 *
 * @example
 * formatPhoneForExotel('9504785931') // Returns: '+919504785931'
 * formatPhoneForExotel('08047362942') // Returns: '+918047362942'
 * formatPhoneForExotel('919504785931') // Returns: '+919504785931'
 * formatPhoneForExotel('+919504785931') // Returns: '+919504785931'
 */
export function formatPhoneForExotel(phone: string): string {
  if (!phone) {
    return phone;
  }

  let cleaned = phone.toString().trim().replace(/\s+/g, '');

  // Already in E.164 format
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  // Handle numbers starting with 0 (like 08047362942)
  if (/^0\d{10}$/.test(cleaned)) {
    return `+91${cleaned.substring(1)}`;
  }

  // Handle 10-digit numbers
  if (/^\d{10}$/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  // Handle numbers starting with 91
  if (/^91\d{10}$/.test(cleaned)) {
    return `+${cleaned}`;
  }

  // Return as-is if no pattern matches
  return cleaned;
}

interface ExotelCallConfig {
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
}

interface InitiateCallResult {
  success: boolean;
  callSid?: string;
  error?: string;
  status?: number;
  response?: any;
  details?: any;
  received?: any;
  formatted?: string;
  parsed?: any;
}

/**
 * Initiate a call via Exotel Connect API
 *
 * @param {Object} config - Configuration object
 * @param {string} config.exotelSid - Exotel SID
 * @param {string} config.apiKey - Exotel API Key
 * @param {string} config.apiToken - Exotel API Token
 * @param {string} config.agentNumber - Agent's phone number (E.164 format)
 * @param {string} config.customerNumber - Customer's phone number (E.164 format)
 * @param {string} config.callerId - Caller ID to display (E.164 format)
 * @param {string} [config.statusCallback] - Webhook URL for status updates
 * @param {string} [config.customField] - Custom field (e.g., 'contact_id:123')
 * @param {number} [config.timeLimit=300] - Max call duration in seconds (default: 5 minutes)
 * @param {number} [config.timeOut=30] - Ring timeout in seconds (default: 30 seconds)
 * @param {boolean} [config.record=true] - Whether to record the call
 * @param {string} [config.recordingChannels='dual'] - Recording channels ('dual' or 'single')
 * @param {string} [config.flowUrl] - Optional call flow URL
 *
 * @returns {Promise<InitiateCallResult>} - Result object
 *
 * @example
 * const result = await initiateExotelCall({
 *   exotelSid: 'your_sid',
 *   apiKey: 'your_key',
 *   apiToken: 'your_token',
 *   agentNumber: '+919504785931',
 *   customerNumber: '+919876543210',
 *   callerId: '+918047362942',
 *   statusCallback: 'https://yourdomain.com/webhook/exotel',
 *   customField: 'contact_id:123'
 * });
 *
 * if (result.success) {
 *   console.log('Call initiated:', result.callSid);
 * } else {
 *   console.error('Call failed:', result.error);
 * }
 */
export async function initiateExotelCall(
  config: ExotelCallConfig,
): Promise<InitiateCallResult> {
  const {
    exotelSid,
    apiKey,
    apiToken,
    agentNumber,
    customerNumber,
    callerId,
    statusCallback,
    customField,
    timeLimit = 300,
    timeOut = 30,
    record = true,
    recordingChannels = 'dual',
    flowUrl,
  } = config;

  // Validate required parameters
  const required: Record<string, any> = {
    exotelSid,
    apiKey,
    apiToken,
    agentNumber,
    customerNumber,
    callerId,
  };
  const missing = Object.entries(required)
    .filter(([_key, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    return {
      success: false,
      error: `Missing required parameters: ${missing.join(', ')}`,
    };
  }

  // Format phone numbers
  const formattedAgentNumber = formatPhoneForExotel(agentNumber);
  const formattedCustomerNumber = formatPhoneForExotel(customerNumber);
  const formattedCallerId = formatPhoneForExotel(callerId);

  // Validate phone number formats
  if (
    !formattedAgentNumber.startsWith('+') ||
    formattedAgentNumber.length < 12
  ) {
    return {
      success: false,
      error:
        'Invalid agent number format. Must be E.164 format (e.g., +919504785931)',
      received: agentNumber,
      formatted: formattedAgentNumber,
    };
  }

  if (
    !formattedCustomerNumber.startsWith('+') ||
    formattedCustomerNumber.length < 12
  ) {
    return {
      success: false,
      error: 'Invalid customer number format. Must be E.164 format',
      received: customerNumber,
      formatted: formattedCustomerNumber,
    };
  }

  if (!formattedCallerId.startsWith('+') || formattedCallerId.length < 12) {
    return {
      success: false,
      error:
        'Invalid caller ID format. Must be E.164 format (e.g., +918047362942)',
      received: callerId,
      formatted: formattedCallerId,
    };
  }

  // Prepare Exotel API URL
  const exotelUrl = `https://${apiKey}:${apiToken}@api.exotel.com/v1/Accounts/${exotelSid}/Calls/connect`;

  // Prepare request parameters
  const exotelParams: Record<string, string> = {
    From: formattedAgentNumber, // Agent's number (Exotel calls this first)
    To: formattedCustomerNumber, // Customer's number (Exotel calls this second)
    CallerId: formattedCallerId, // Number displayed to customer
    StatusCallbackContentType: 'application/json',
    TimeLimit: timeLimit.toString(),
    TimeOut: timeOut.toString(),
    Record: record.toString(),
    RecordingChannels: recordingChannels,
  };

  // Add optional parameters
  if (statusCallback) {
    exotelParams.StatusCallback = statusCallback;
  }

  if (customField) {
    exotelParams.CustomField = customField;
  }

  if (flowUrl) {
    exotelParams.Url = flowUrl;
  }

  try {
    // Make API call to Exotel
    const response = await axios.post(exotelUrl, exotelParams, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30000, // 30 second timeout
    });

    // Check response status
    if (response.status !== 200) {
      return {
        success: false,
        error: `Exotel API returned status ${response.status}`,
        status: response.status,
        response: response.data,
      };
    }

    // Parse XML response
    const parser = new xml2js.Parser();
    const parsedResponse = await parser.parseStringPromise(response.data);

    // Extract CallSid from XML response
    // Exotel returns XML in format: <TwilioResponse><Call><Sid>...</Sid></Call></TwilioResponse>
    const callSid = parsedResponse?.TwilioResponse?.Call?.[0]?.Sid?.[0];

    if (!callSid) {
      return {
        success: false,
        error: 'No CallSid received from Exotel API',
        response: response.data,
        parsed: parsedResponse,
      };
    }

    return {
      success: true,
      callSid: callSid,
    };
  } catch (error: any) {
    console.error('Exotel API error:', error.message);

    if (error.response) {
      return {
        success: false,
        error: `Exotel API error: ${error.response.status} - ${error.response.statusText}`,
        status: error.response.status,
        details: error.response.data,
      };
    }

    if (error.request) {
      return {
        success: false,
        error: `Network error: No response from Exotel API`,
        details: error.message,
      };
    }

    return {
      success: false,
      error: `Error: ${error.message}`,
    };
  }
}

/**
 * Map Exotel status to internal status
 *
 * @param {string} exotelStatus - Status from Exotel webhook
 * @param {string} [exotelOutcome] - Outcome from Exotel webhook (fallback)
 * @returns {string} - Internal status
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
 * Extract contact ID from CustomField
 *
 * @param {string} customField - CustomField from webhook (e.g., 'contact_id:123')
 * @returns {number|null} - Contact ID or null
 */
export function extractContactId(customField?: string): number | null {
  if (!customField) return null;

  const match = customField.match(/contact_id:(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

interface WebhookData {
  CallSid?: string;
  Status?: string;
  Duration?: string | number;
  RecordingUrl?: string;
  Outcome?: string;
  ConversationDuration?: string | number;
  CustomField?: string;
  To?: string;
  From?: string;
}

interface WebhookResult {
  success: boolean;
  message?: string;
  contactId?: number | null;
  status?: string;
  duration?: number;
  callSid?: string;
  error?: string;
  received?: any;
}

/**
 * Handle Exotel webhook callback
 *
 * @param {Object} webhookData - Webhook payload from Exotel
 * @param {Function} updateContact - Async function to update contact: (contactId, data) => Promise
 * @param {Function} updateCallLog - Async function to update/create call log: (logData) => Promise
 * @returns {Promise<WebhookResult>} - Result object
 *
 * @example
 * const result = await handleExotelWebhook(
 *   req.body,
 *   async (contactId, data) => {
 *     await Contact.update(data, { where: { id: contactId } });
 *   },
 *   async (logData) => {
 *     await CallLog.create(logData);
 *   }
 * );
 */
export async function handleExotelWebhook(
  webhookData: WebhookData,
  updateContact?: (
    contactId: number,
    data: Record<string, any>,
  ) => Promise<void>,
  updateCallLog?: (logData: Record<string, any>) => Promise<void>,
): Promise<WebhookResult> {
  const {
    CallSid,
    Status,
    Duration,
    RecordingUrl,
    Outcome,
    ConversationDuration,
    CustomField,
    To,
    From,
  } = webhookData;

  // Validate required fields
  if (!CallSid || (!Status && !Outcome)) {
    return {
      success: false,
      error: 'Missing required fields: CallSid and Status/Outcome are required',
      received: { CallSid, Status, Outcome },
    };
  }

  // Extract contact ID from CustomField
  const contactId = extractContactId(CustomField);

  // Map Exotel status to internal status
  const contactStatus = mapExotelStatus(Status, Outcome);

  // Get duration (prefer ConversationDuration as it's actual talk time)
  const callDuration = ConversationDuration || Duration || 0;
  const durationSeconds =
    typeof callDuration === 'string'
      ? parseInt(callDuration, 10) || 0
      : parseInt(callDuration as any, 10) || 0;

  // Update contact if contactId is available
  if (contactId && updateContact) {
    try {
      await updateContact(contactId, {
        status: contactStatus,
        duration: durationSeconds,
        recording_url: RecordingUrl || null,
        exotel_call_sid: CallSid,
      });
    } catch (error: any) {
      console.error('Error updating contact:', error);
      return {
        success: false,
        error: `Failed to update contact: ${error.message}`,
      };
    }
  }

  // Update call log if contactId is available
  if (contactId && updateCallLog) {
    try {
      await updateCallLog({
        contact_id: contactId,
        call_sid: CallSid,
        status: contactStatus,
        duration: durationSeconds,
        recording_url: RecordingUrl || null,
        to: To,
        from: From,
      });
    } catch (error: any) {
      console.error('Error updating call log:', error);
      // Don't fail the webhook if call log update fails
    }
  }

  return {
    success: true,
    message: 'Webhook processed successfully',
    contactId,
    status: contactStatus,
    duration: durationSeconds,
    callSid: CallSid,
  };
}

interface FetchCallDetailsConfig {
  exotelSid: string;
  apiKey: string;
  apiToken: string;
  callSid: string;
}

interface FetchCallDetailsResult {
  success: boolean;
  call?: any;
  error?: string;
  response?: any;
}

/**
 * Fetch call details from Exotel API
 * Useful for getting exact duration after call completes
 *
 * @param {Object} config - Configuration
 * @param {string} config.exotelSid - Exotel SID
 * @param {string} config.apiKey - Exotel API Key
 * @param {string} config.apiToken - Exotel API Token
 * @param {string} config.callSid - CallSid to fetch details for
 * @returns {Promise<FetchCallDetailsResult>} - Call details
 */
export async function fetchCallDetails(
  config: FetchCallDetailsConfig,
): Promise<FetchCallDetailsResult> {
  const { exotelSid, apiKey, apiToken, callSid } = config;

  if (!exotelSid || !apiKey || !apiToken || !callSid) {
    return {
      success: false,
      error: 'Missing required parameters',
    };
  }

  try {
    const exotelApiUrl = `https://${apiKey}:${apiToken}@api.exotel.com/v1/Accounts/${exotelSid}/Calls/${callSid}.json`;

    const response = await axios.get(exotelApiUrl, {
      timeout: 10000,
    });

    if (response.data && response.data.Call) {
      return {
        success: true,
        call: response.data.Call,
      };
    }

    return {
      success: false,
      error: 'Invalid response from Exotel API',
      response: response.data,
    };
  } catch (error: any) {
    console.error('Error fetching call details:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}
