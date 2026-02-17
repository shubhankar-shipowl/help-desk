const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4004';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

const MAX_RETRIES = 3;
const BASE_RETRY_DELAY = 500;
const REQUEST_TIMEOUT = 10000;

async function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function callNotificationService(endpoint: string, body: Record<string, any>): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      const response = await fetch(`${NOTIFICATION_SERVICE_URL}/internal/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-key': INTERNAL_API_KEY,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const error = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error(`[NotificationClient] ${endpoint} failed (status ${response.status}):`, error);

        // Retry on 502, 503, 504
        if (attempt < MAX_RETRIES && (response.status === 502 || response.status === 503 || response.status === 504)) {
          const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
          console.warn(`[NotificationClient] Retrying ${endpoint} in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep(delay);
          continue;
        }
      }
      return;
    } catch (error: any) {
      lastError = error;

      if (attempt < MAX_RETRIES) {
        const delay = BASE_RETRY_DELAY * Math.pow(2, attempt);
        console.warn(`[NotificationClient] ${endpoint} error, retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}):`, error.message);
        await sleep(delay);
      } else {
        console.error(`[NotificationClient] Failed to call ${endpoint} after ${MAX_RETRIES} retries:`, error.message);
      }
    }
  }
}

export async function triggerTicketCreated(ticketId: string): Promise<void> {
  await callNotificationService('trigger/ticket-created', { ticketId });
}

export async function triggerTicketAssigned(ticketId: string, assignedById?: string): Promise<void> {
  await callNotificationService('trigger/ticket-assigned', { ticketId, assignedById });
}

export async function triggerNewReply(ticketId: string, commentId: string): Promise<void> {
  await callNotificationService('trigger/new-reply', { ticketId, commentId });
}

export async function triggerStatusChanged(ticketId: string, oldStatus: string, changedById?: string): Promise<void> {
  await callNotificationService('trigger/status-changed', { ticketId, oldStatus, changedById });
}
