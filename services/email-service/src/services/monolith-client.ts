import { createHttpClient } from '@customer-support/shared';

const MONOLITH_URL = process.env.MONOLITH_URL || 'http://localhost:3002';
const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:3004';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

const client = createHttpClient({
  baseURL: MONOLITH_URL,
  timeout: 30000,
  internalApiKey: INTERNAL_API_KEY,
  maxRetries: 3,
  baseRetryDelay: 500,
});

const notificationClient = createHttpClient({
  baseURL: NOTIFICATION_SERVICE_URL,
  timeout: 30000,
  internalApiKey: INTERNAL_API_KEY,
  maxRetries: 3,
  baseRetryDelay: 500,
});

/**
 * Call monolith to auto-assign a ticket
 */
export async function callAutoAssignTicket(ticketId: string): Promise<void> {
  try {
    await client.post(`/api/internal/tickets/${ticketId}/auto-assign`);
    console.log(`[Monolith Client] Auto-assign triggered for ticket ${ticketId}`);
  } catch (error: any) {
    console.error(`[Monolith Client] Failed to auto-assign ticket ${ticketId}:`, error.message);
    // Don't throw - auto-assign failure shouldn't block ticket creation
  }
}

/**
 * Call monolith to send acknowledgment email for a ticket
 */
export async function callSendAcknowledgment(ticketId: string, options?: { inReplyTo?: string }): Promise<void> {
  try {
    await client.post(`/api/internal/tickets/${ticketId}/send-acknowledgment`, options || {});
    console.log(`[Monolith Client] Acknowledgment sent for ticket ${ticketId}`);
  } catch (error: any) {
    console.error(`[Monolith Client] Failed to send acknowledgment for ticket ${ticketId}:`, error.message);
  }
}

/**
 * Call notification service to trigger new reply notification
 */
export async function callNewReplyNotification(data: {
  ticketId: string;
  replyId: string;
  commentId?: string;
}): Promise<void> {
  try {
    await notificationClient.post('/internal/trigger/new-reply', {
      ticketId: data.ticketId,
      commentId: data.commentId || data.replyId,
    });
    console.log(`[Monolith Client] New reply notification triggered for ticket ${data.ticketId}`);
  } catch (error: any) {
    console.error(`[Monolith Client] Failed to trigger notification:`, error.message);
  }
}
