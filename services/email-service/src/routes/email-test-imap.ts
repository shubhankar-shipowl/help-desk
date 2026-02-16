import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';
import Imap from 'imap';

export const emailTestImapRouter = Router();

emailTestImapRouter.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    if (user.role !== 'ADMIN') return res.status(401).json({ error: 'Unauthorized' });

    const tenantId = user.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

    const { storeId } = req.body;
    if (!storeId) return res.status(400).json({ error: 'Store ID is required' });

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
      return res.status(400).json({
        error: 'IMAP credentials not configured.',
      });
    }

    // Test IMAP connection
    const imap = new Imap({
      user: imapEmail, password: imapAppPassword,
      host: 'imap.gmail.com', port: 993, tls: true,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000, authTimeout: 10000,
    });

    const timeout = setTimeout(() => {
      imap.end();
      res.status(500).json({ error: 'Connection timeout.' });
    }, 15000);

    imap.once('ready', () => {
      clearTimeout(timeout);
      imap.openBox('INBOX', true, (err, box) => {
        imap.end();
        if (err) return res.status(500).json({ error: `Failed to open INBOX: ${err.message}` });
        res.json({
          success: true,
          message: `IMAP connection successful! Found ${box.messages.total} total messages, ${box.messages.new} unread.`,
          stats: { total: box.messages.total, unread: box.messages.new },
        });
      });
    });

    imap.once('error', (err: Error) => {
      clearTimeout(timeout);
      imap.end();
      let errorMessage = err.message;
      if (errorMessage.includes('authentication') || errorMessage.includes('Invalid credentials')) {
        errorMessage = 'Gmail authentication failed.';
      }
      res.status(500).json({ error: errorMessage });
    });

    imap.connect();
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to test IMAP connection' });
  }
});
