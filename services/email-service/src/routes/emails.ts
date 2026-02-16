import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';

export const emailsRouter = Router();

async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3, baseDelayMs = 500): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const msg = (error as Error).message || '';
      if (msg.includes("Can't reach database") || msg.includes('Connection refused') ||
          msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) {
        if (attempt < maxRetries - 1) {
          await new Promise(r => setTimeout(r, baseDelayMs * Math.pow(2, attempt)));
          continue;
        }
      }
      throw error;
    }
  }
  throw lastError;
}

emailsRouter.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

    const page = parseInt(req.query.page as string || '1');
    const limit = parseInt(req.query.limit as string || '50');
    const read = req.query.read === 'true' ? true : req.query.read === 'false' ? false : undefined;
    const storeId = req.query.storeId as string | undefined;
    const skip = (page - 1) * limit;

    const where: any = { tenantId };

    if (user.role === 'ADMIN') {
      if (!storeId) return res.status(400).json({ error: 'Store ID is required for admin users' });
      where.storeId = storeId;
    } else if (user.role === 'AGENT' && storeId) {
      where.storeId = storeId;
    }

    if (read !== undefined) where.read = read;

    const baseWhere: any = { tenantId };
    if (user.role === 'ADMIN' && storeId) baseWhere.storeId = storeId;
    else if (user.role === 'AGENT' && storeId) baseWhere.storeId = storeId;

    const [emails, total, unreadCount, readCount, totalAll] = await withRetry(() =>
      Promise.all([
        prisma.email.findMany({
          where,
          select: {
            id: true, tenantId: true, storeId: true, messageId: true, threadId: true,
            gmailId: true, fromEmail: true, fromName: true, toEmail: true, ccEmail: true,
            bccEmail: true, subject: true, snippet: true, textContent: true, htmlContent: true,
            headers: true, labelIds: true, internalDate: true, historyId: true, direction: true,
            read: true, readAt: true, ticketId: true, processed: true, processedAt: true,
            hasAttachments: true, createdAt: true, updatedAt: true,
            Ticket: { select: { id: true, ticketNumber: true, subject: true, status: true } },
            EmailAttachment: { select: { id: true, filename: true, mimeType: true, size: true, fileUrl: true } },
            EmailReply_EmailReply_originalEmailIdToEmail: {
              select: { id: true, subject: true, bodyText: true, bodyHtml: true, sentAt: true, sentBy: true },
              orderBy: { sentAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip, take: limit,
        }),
        prisma.email.count({ where }),
        prisma.email.count({ where: { ...baseWhere, read: false } }),
        prisma.email.count({ where: { ...baseWhere, read: true } }),
        prisma.email.count({ where: baseWhere }),
      ])
    );

    const transformedEmails = emails.map((email: any) => ({
      ...email,
      ticket: email.Ticket || null,
      hasAttachments: email.EmailAttachment && email.EmailAttachment.length > 0,
      replies: email.EmailReply_EmailReply_originalEmailIdToEmail || [],
    }));

    res.json({ emails: transformedEmails, total, unreadCount, readCount, totalAll, page, totalPages: Math.ceil(total / limit) });
  } catch (error: any) {
    console.error('Error fetching emails:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch emails' });
  }
});
