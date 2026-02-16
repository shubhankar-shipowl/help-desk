import { Router, Request, Response } from 'express';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import {
  startGmailSync, stopGmailSync, getGmailSyncStatus,
  isGmailSyncRunning, getAllActiveSyncs,
} from '../services/gmail-sync-service';
import { getSystemSetting } from '../services/system-settings';

export const emailSyncRouter = Router();

emailSyncRouter.get('/', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const storeId = req.query.storeId as string | undefined;

    if (!storeId) {
      if (user.role === 'ADMIN') {
        const activeSyncs = getAllActiveSyncs();
        return res.json({ activeSyncs, count: activeSyncs.length });
      }
      return res.status(400).json({ error: 'Store ID is required' });
    }

    const status = getGmailSyncStatus(storeId);
    const isRunning = isGmailSyncRunning(storeId);

    res.json({ storeId, isRunning, status });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to get sync status' });
  }
});

emailSyncRouter.post('/', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

    const { action, storeId } = req.body;

    if (!storeId) return res.status(400).json({ error: 'Store ID is required' });
    if (!action || !['start', 'stop'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use "start" or "stop"' });
    }

    if (action === 'stop') {
      stopGmailSync(storeId);
      return res.json({ success: true, message: 'Gmail sync stopped', isRunning: false });
    }

    const [imapEmail, imapAppPassword] = await Promise.all([
      getSystemSetting('IMAP_EMAIL', tenantId, storeId),
      getSystemSetting('IMAP_APP_PASSWORD', tenantId, storeId),
    ]);

    if (!imapEmail || !imapAppPassword) {
      return res.status(400).json({
        error: 'Email integration not configured. Please configure IMAP settings first.',
      });
    }

    if (isGmailSyncRunning(storeId)) {
      return res.json({
        success: true, message: 'Gmail sync already running',
        isRunning: true, status: getGmailSyncStatus(storeId),
      });
    }

    await startGmailSync(storeId, { email: imapEmail, appPassword: imapAppPassword, tenantId });

    res.json({
      success: true, message: 'Gmail sync started',
      isRunning: true, status: getGmailSyncStatus(storeId),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to manage sync' });
  }
});
