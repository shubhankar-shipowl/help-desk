import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware } from '../middleware/auth';

export const emailByIdRouter = Router();

// GET /:id - Fetch a single email with full content (used by detail view after compact list load)
emailByIdRouter.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const email = await prisma.email.findUnique({
      where: { id: req.params.id },
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
          orderBy: { sentAt: 'asc' as const },
        },
      },
    });

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const transformed = {
      ...email,
      ticket: (email as any).Ticket || null,
      hasAttachments: (email as any).EmailAttachment && (email as any).EmailAttachment.length > 0,
      replies: (email as any).EmailReply_EmailReply_originalEmailIdToEmail || [],
    };

    res.json({ email: transformed });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch email' });
  }
});

emailByIdRouter.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const email = await prisma.email.update({
      where: { id: req.params.id },
      data: { read: true, readAt: new Date() },
    });

    res.json({ success: true, email });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to mark email as read' });
  }
});
