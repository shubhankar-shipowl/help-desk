import { Router, Request, Response } from 'express';
import { prisma } from '../config/database';
import { authMiddleware, requireAgentOrAdmin } from '../middleware/auth';
import { sendEmail } from '../services/email-sender';
import { randomUUID } from 'crypto';

export const emailReplyRouter = Router();

emailReplyRouter.post('/:id/reply', authMiddleware, requireAgentOrAdmin, async (req: Request, res: Response) => {
  try {
    const user = req.user!;
    const tenantId = user.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Tenant ID is required' });

    const { subject, body: replyBody, toEmail, ccEmail } = req.body;

    if (!subject || !replyBody || !toEmail) {
      return res.status(400).json({ error: 'Subject, body, and recipient email are required' });
    }

    const originalEmail = await prisma.email.findUnique({
      where: { id: req.params.id },
      include: {
        EmailReply_EmailReply_originalEmailIdToEmail: {
          select: { inReplyTo: true, references: true, sentAt: true },
          orderBy: { sentAt: 'asc' },
        },
      },
    });

    if (!originalEmail) return res.status(404).json({ error: 'Email not found' });

    const storeId = originalEmail.storeId || null;

    // Build References header for threading
    const referencesMessageIds: string[] = [];

    if (originalEmail.messageId) {
      const normalizedMsgId = originalEmail.messageId.replace(/^<|>$/g, '').trim();
      referencesMessageIds.push(`<${normalizedMsgId}>`);
    }

    if (originalEmail.headers) {
      const headers = originalEmail.headers as Record<string, any>;
      const refsHeader = headers['references'] || headers['References'] || headers['reference'];
      if (refsHeader) {
        String(refsHeader).split(/\s+/).filter(Boolean).forEach(ref => {
          const normalized = ref.replace(/^<|>$/g, '').trim();
          if (normalized && !referencesMessageIds.includes(`<${normalized}>`)) {
            referencesMessageIds.push(`<${normalized}>`);
          }
        });
      }
    }

    originalEmail.EmailReply_EmailReply_originalEmailIdToEmail.forEach((reply: any) => {
      if (reply.references) {
        String(reply.references).split(/\s+/).filter(Boolean).forEach(ref => {
          const normalized = ref.replace(/^<|>$/g, '').trim();
          if (normalized && !referencesMessageIds.includes(`<${normalized}>`)) {
            referencesMessageIds.push(`<${normalized}>`);
          }
        });
      }
      if (reply.inReplyTo) {
        const normalized = reply.inReplyTo.replace(/^<|>$/g, '').trim();
        if (normalized && !referencesMessageIds.includes(`<${normalized}>`)) {
          referencesMessageIds.push(`<${normalized}>`);
        }
      }
    });

    const referencesHeader = referencesMessageIds.length > 0
      ? referencesMessageIds.join(' ')
      : (originalEmail.messageId ? `<${originalEmail.messageId.replace(/^<|>$/g, '').trim()}>` : undefined);

    const inReplyTo = referencesMessageIds.length > 0
      ? referencesMessageIds[referencesMessageIds.length - 1]
      : (originalEmail.messageId ? `<${originalEmail.messageId.replace(/^<|>$/g, '').trim()}>` : undefined);

    const emailResult = await sendEmail({
      to: toEmail,
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      html: replyBody.replace(/\n/g, '<br>'),
      text: replyBody,
      inReplyTo, references: referencesHeader,
      tenantId, storeId,
    });

    if (!emailResult.success) {
      return res.status(500).json({ error: emailResult.error?.message || 'Failed to send email' });
    }

    await prisma.email.update({ where: { id: originalEmail.id }, data: { read: true } });

    const now = new Date();
    const emailReply = await prisma.emailReply.create({
      data: {
        id: randomUUID(), tenantId, storeId,
        originalEmailId: originalEmail.id,
        sentBy: user.id, toEmail, ccEmail: ccEmail || null,
        subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
        bodyText: replyBody, bodyHtml: replyBody.replace(/\n/g, '<br>'),
        inReplyTo: inReplyTo || null, references: referencesHeader || null,
        status: 'SENT', sentAt: now, updatedAt: now,
      },
    });

    if (originalEmail.ticketId) {
      try {
        await prisma.comment.create({
          data: {
            id: randomUUID(), content: replyBody,
            ticketId: originalEmail.ticketId, authorId: user.id,
            isInternal: false, createdAt: now, updatedAt: now,
          },
        });
      } catch (commentError) {
        console.error('Error creating comment from email reply:', commentError);
      }
    }

    res.json({ success: true, message: 'Email reply sent successfully', emailReply });
  } catch (error: any) {
    console.error('Error sending email reply:', error);
    res.status(500).json({ error: error.message || 'Failed to send email reply' });
  }
});
