import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import { fetchAndStoreGmailEmails, FetchOptions } from '../services/gmail-fetcher';

export const emailFetchRouter = Router();

const FETCH_TIMEOUT_MS = 120000; // 2 minutes max for the entire operation

emailFetchRouter.post('/', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  let hasResponded = false;

  /** Send a JSON response only once, even if called multiple times */
  const respond = (status: number, data: any) => {
    if (hasResponded) return;
    hasResponded = true;
    clearTimeout(safetyTimeout);
    try {
      res.status(status).json(data);
    } catch {
      // Response already sent or connection closed
    }
  };

  // Safety timeout: guarantee the client gets a response
  const safetyTimeout = setTimeout(() => {
    console.error('[IMAP Fetch] Operation timed out after 2 minutes');
    respond(504, { error: 'Email fetch timed out. The inbox may have too many emails. Try "Fetch Latest" with a smaller limit.' });
  }, FETCH_TIMEOUT_MS);

  try {
    const user = req.user!;
    const tenantId = user.tenantId;
    if (!tenantId) { respond(400, { error: 'Tenant ID is required' }); return; }

    const { storeId, mode = 'unread', limit } = req.body;

    if (user.role === 'ADMIN' && !storeId) {
      respond(400, { error: 'Store ID is required for admin users' });
      return;
    }

    if (storeId) {
      const store = await prisma.store.findFirst({
        where: { id: storeId, tenantId, isActive: true },
      });
      if (!store) { respond(400, { error: 'Invalid store ID' }); return; }
    }

    // Get IMAP credentials
    let settings = await prisma.systemSettings.findMany({
      where: { tenantId, storeId: storeId || null, key: { in: ['IMAP_EMAIL', 'IMAP_APP_PASSWORD'] } },
    });

    const hasImapEmail = settings.some((s: any) => s.key === 'IMAP_EMAIL');
    const hasImapPassword = settings.some((s: any) => s.key === 'IMAP_APP_PASSWORD');

    if ((!hasImapEmail || !hasImapPassword) && storeId) {
      const tenantSettings = await prisma.systemSettings.findMany({
        where: { tenantId, storeId: null, key: { in: ['IMAP_EMAIL', 'IMAP_APP_PASSWORD'] } },
      });
      const existingKeys = new Set(settings.map((s: any) => s.key));
      tenantSettings.forEach((setting: any) => {
        if (!existingKeys.has(setting.key)) settings.push(setting);
      });
    }

    const configMap: Record<string, string> = {};
    settings.forEach((s: any) => { configMap[s.key] = s.value; });

    const imapEmail = configMap.IMAP_EMAIL;
    const imapAppPassword = configMap.IMAP_APP_PASSWORD;

    if (!imapEmail || !imapAppPassword) {
      respond(400, {
        error: 'IMAP credentials not configured. Please configure IMAP_EMAIL and IMAP_APP_PASSWORD in Email Integrations settings.',
      });
      return;
    }

    const fetchOptions: FetchOptions = {
      mode: mode === 'latest' ? 'latest' : 'unread',
      limit: mode === 'latest' ? (limit || 200) : undefined,
    };

    const result = await fetchAndStoreGmailEmails(
      { email: imapEmail, appPassword: imapAppPassword, tenantId, storeId: storeId || null },
      fetchOptions
    );

    const attachmentMsg = result.attachmentsUploaded > 0
      ? `, ${result.attachmentsUploaded} attachments uploaded to MEGA`
      : '';

    respond(200, {
      success: true,
      message: `Fetched ${result.fetched} emails, stored ${result.stored} new emails${attachmentMsg}`,
      stats: result,
    });
  } catch (error: any) {
    console.error('[IMAP Fetch] Error:', error?.message || error);

    let errorMessage = error?.message || 'Failed to fetch emails';
    if (errorMessage.includes('authentication') || errorMessage.includes('Invalid credentials')) {
      errorMessage = 'Gmail authentication failed. Please check your email and app password.';
    } else if (errorMessage.includes('timeout')) {
      errorMessage = 'Connection timeout. Please try again.';
    }

    respond(500, { error: errorMessage });
  }
});
