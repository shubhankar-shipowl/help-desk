import { createHttpClient } from '@customer-support/shared';

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4004';
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || '';

const client = createHttpClient({
  baseURL: NOTIFICATION_SERVICE_URL,
  timeout: 10000,
  internalApiKey: INTERNAL_API_KEY,
  maxRetries: 3,
  baseRetryDelay: 500,
});

export async function createNotification(data: {
  type: string;
  title: string;
  message: string;
  userId: string;
  ticketId?: string;
  metadata?: Record<string, any>;
  channels?: string[];
}): Promise<{ id: string; [key: string]: any }> {
  try {
    const response = await client.post('/internal/create-notification', data);
    return response.data.notification || response.data;
  } catch (error: any) {
    console.error('[Notification Client] Error creating notification:', error.message);
    throw error;
  }
}
