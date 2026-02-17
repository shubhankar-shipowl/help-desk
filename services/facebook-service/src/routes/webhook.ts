import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { Notification_type } from '@prisma/client';
import { createNotification } from '../services/notification-client';
import crypto from 'crypto';

const router = Router();

/**
 * Middleware to validate Facebook webhook signature (X-Hub-Signature-256).
 * Facebook signs all POST webhook payloads with HMAC-SHA256 using the app secret.
 */
function validateFacebookSignature(req: Request, res: Response, next: NextFunction): void {
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  const appSecret = process.env.FACEBOOK_APP_SECRET;

  if (!appSecret) {
    console.warn('[Facebook Webhook] FACEBOOK_APP_SECRET not configured - skipping signature validation');
    next();
    return;
  }

  if (!signature) {
    console.error('[Facebook Webhook] Missing X-Hub-Signature-256 header');
    res.status(403).json({ error: 'Missing signature' });
    return;
  }

  const rawBody = (req as any).rawBody;
  if (!rawBody) {
    console.error('[Facebook Webhook] Raw body not available for signature validation');
    res.status(500).json({ error: 'Internal error' });
    return;
  }

  const expectedSignature = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
    console.error('[Facebook Webhook] Invalid signature');
    res.status(403).json({ error: 'Invalid signature' });
    return;
  }

  next();
}

// GET /webhooks/facebook - Facebook webhook verification
router.get('/', async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string | undefined;
  const token = req.query['hub.verify_token'] as string | undefined;
  const challenge = req.query['hub.challenge'] as string | undefined;

  console.log('[Facebook Webhook Verification] Incoming verification request');

  let verifyTokens: string[] = [];

  if (process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN) {
    verifyTokens.push(process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN);
  }

  try {
    const settings = await prisma.systemSettings.findMany({
      where: { key: 'FACEBOOK_WEBHOOK_VERIFY_TOKEN' },
    });

    settings.forEach((setting: { value: string }) => {
      if (setting.value && !verifyTokens.includes(setting.value)) {
        verifyTokens.push(setting.value);
      }
    });
  } catch (error: any) {
    console.warn('[Facebook Webhook Verification] Could not fetch verify token from SystemSettings:', error.message);
  }

  if (mode === 'subscribe') {
    const tokenMatches = verifyTokens.some(vt => vt === token);

    if (tokenMatches) {
      console.log('[Facebook Webhook Verification] Verified successfully');
      res.status(200).set('Content-Type', 'text/plain').send(challenge || '');
      return;
    }
  }

  console.log('[Facebook Webhook Verification] Verification failed');
  res.status(403).json({ error: 'Forbidden' });
});

// POST /webhooks/facebook - Facebook webhook event handler
router.post('/', validateFacebookSignature, async (req: Request, res: Response) => {
  try {
    const body = req.body;

    console.log('[Facebook Webhook] Received webhook event');
    console.log('[Facebook Webhook] Object:', body.object);
    console.log('[Facebook Webhook] Entry count:', body.entry?.length || 0);

    if (body.object === 'page' && body.entry) {
      for (const entry of body.entry) {
        let pageId = entry.id || entry.page_id || entry.page?.id;

        if (pageId === '0' || pageId === 0 || !pageId) {
          pageId = null;
        }

        let finalPageId = pageId;
        if (!finalPageId || finalPageId === '0' || finalPageId === 0) {
          const allIntegrations = await prisma.facebookIntegration.findMany({
            where: { isActive: true },
          });

          if (allIntegrations.length === 1) {
            finalPageId = allIntegrations[0].pageId;
          } else if (allIntegrations.length > 1) {
            finalPageId = allIntegrations[0].pageId;
          } else {
            continue;
          }
        }

        if (!finalPageId || finalPageId === '0' || finalPageId === 0) {
          continue;
        }

        if (entry.messaging && finalPageId) {
          for (const event of entry.messaging) {
            await handleFacebookMessage(event, String(finalPageId));
          }
        }

        if (entry.changes && finalPageId) {
          for (const change of entry.changes) {
            if (change.value) {
              try {
                await handleFacebookChange(change, String(finalPageId));
              } catch (changeError: any) {
                console.error('[Facebook Webhook] Error processing change:', changeError.message);
              }
            }
          }
        }
      }
    }

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('[Facebook Webhook] Error processing webhook:', error.message);
    res.status(200).json({ success: false, error: error.message });
  }
});

async function handleFacebookMessage(event: any, pageId: string) {
  const integration = await prisma.facebookIntegration.findFirst({
    where: { pageId, isActive: true },
  });

  if (!integration || !integration.isActive) {
    return;
  }

  const users = await prisma.user.findMany({
    where: { role: 'ADMIN', isActive: true },
  });

  for (const user of users) {
    const notification = await prisma.notification.create({
      data: {
        id: crypto.randomUUID(),
        type: Notification_type.FACEBOOK_MESSAGE,
        title: 'New Facebook Message',
        message: `New message from ${event.sender?.id || 'Facebook user'}`,
        userId: user.id,
        metadata: {
          pageId,
          senderId: event.sender?.id,
          message: event.message?.text,
          timestamp: event.timestamp,
        },
        updatedAt: new Date(),
      },
    });

    await prisma.facebookNotification.create({
      data: {
        id: crypto.randomUUID(),
        type: 'MESSAGE',
        facebookId: event.sender?.id || '',
        content: event.message?.text || '',
        author: 'Facebook User',
        postUrl: event.sender?.id ? `https://www.facebook.com/messages/t/${event.sender?.id}` : null,
        notificationId: notification.id,
      },
    });
  }
}

async function handleFacebookChange(change: any, pageId: string) {
  const isValidPageId = pageId && pageId !== '0' && String(pageId) !== '0';

  let integration;
  if (isValidPageId) {
    integration = await prisma.facebookIntegration.findFirst({
      where: { pageId, isActive: true },
    });
  }

  if (!integration || !isValidPageId) {
    const activeIntegrations = await prisma.facebookIntegration.findMany({
      where: { isActive: true },
    });

    if (activeIntegrations.length === 0) {
      return;
    }

    integration = activeIntegrations[0];
  }

  if (!integration || !integration.isActive) {
    return;
  }

  // Handle mentions
  if (change.field === 'mention' || change.value?.item === 'mention') {
    const postId = change.value?.post_id || change.value?.id;
    const message = change.value?.message || change.value?.text || '';
    const author = change.value?.from?.name || change.value?.author || 'Facebook User';
    const authorId = change.value?.from?.id || change.value?.sender_id || '';

    if (postId) {
      const existing = await prisma.facebookNotification.findFirst({
        where: {
          facebookPostId: postId,
          type: 'MESSAGE',
          createdAt: { gte: new Date(Date.now() - 60000) },
        },
      });
      if (existing) return;
    }

    const users = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
    });

    for (const user of users) {
      try {
        const notification = await createNotification({
          type: Notification_type.FACEBOOK_MESSAGE,
          title: 'Page Mentioned',
          message: `${author} mentioned your page in a post: ${message.substring(0, 100) || 'No message'}`,
          userId: user.id,
          metadata: {
            pageId: integration.pageId,
            pageName: integration.pageName,
            postId,
            message,
            author,
            authorId,
            isMention: true,
          },
          channels: ['IN_APP'],
        });

        await prisma.facebookNotification.create({
          data: {
            id: crypto.randomUUID(),
            type: 'MESSAGE',
            facebookId: postId || authorId || '',
            facebookPostId: postId || '',
            content: message,
            author,
            postUrl: postId ? `https://www.facebook.com/${postId}` : '',
            notificationId: notification.id,
          },
        });
      } catch (error: any) {
        console.error('[Facebook Webhook] Error creating mention notification:', error.message);
      }
    }
    return;
  }

  // Handle comments
  const hasCommentId = !!change.value?.comment_id;
  const isCommentItem = change.value?.item === 'comment';
  const isComment =
    (change.field === 'feed' && hasCommentId) ||
    (change.field === 'feed' && isCommentItem);

  if (isComment) {
    const postId = change.value?.post_id;
    const commentId = change.value?.comment_id;
    const message = change.value?.message || '';
    const author = change.value?.from?.name || change.value?.author || 'Facebook User';

    if (commentId) {
      const existing = await prisma.facebookNotification.findFirst({
        where: { facebookId: commentId, type: 'COMMENT' },
      });
      if (existing) return;
    }

    const users = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
    });

    for (const user of users) {
      try {
        const notification = await createNotification({
          type: Notification_type.FACEBOOK_COMMENT,
          title: 'New Facebook Comment',
          message: `New comment by ${author} on your Facebook post: ${message.substring(0, 100) || 'No message'}`,
          userId: user.id,
          metadata: {
            pageId: integration.pageId,
            pageName: integration.pageName,
            postId,
            commentId,
            message,
            author,
          },
          channels: ['IN_APP'],
        });

        await prisma.facebookNotification.create({
          data: {
            id: crypto.randomUUID(),
            type: 'COMMENT',
            facebookId: commentId || '',
            facebookPostId: postId || '',
            content: message,
            author,
            postUrl: postId ? (commentId ? `https://www.facebook.com/${postId}?comment_id=${commentId}` : `https://www.facebook.com/${postId}`) : '',
            notificationId: notification.id,
          },
        });
      } catch (error: any) {
        console.error('[Facebook Webhook] Error creating comment notification:', error.message);
      }
    }
    return;
  }

  // Handle posts
  if (change.value?.comment_id || change.value?.item === 'comment') {
    return;
  }

  const isPost =
    change.field === 'feed' && (
      change.value?.item === 'post' ||
      (change.value?.verb === 'add' && change.value?.item === 'post') ||
      change.value?.item === 'status' ||
      (change.value?.post_id && !change.value?.comment_id) ||
      (change.value?.id && !change.value?.comment_id && change.value?.item !== 'comment')
    );

  if (isPost) {
    if (change.value?.comment_id || change.value?.item === 'comment') {
      return;
    }

    const postId = change.value?.post_id || change.value?.id;
    const message = change.value?.message || change.value?.text || '';

    // Check for mentions in post
    const messageTags = change.value?.message_tags || [];
    const storyTags = change.value?.story_tags || {};
    const mentions = change.value?.mentions || [];

    const pageMentioned =
      messageTags.some((tag: any) => tag.id === integration.pageId) ||
      Object.values(storyTags).some((tags: any) =>
        Array.isArray(tags) && tags.some((tag: any) => tag.id === integration.pageId)
      ) ||
      mentions.some((mention: any) => mention.id === integration.pageId) ||
      message.includes(`@${integration.pageName}`) ||
      message.includes(`facebook.com/${integration.pageId}`);

    if (pageMentioned) {
      const author = change.value?.from?.name || change.value?.author || 'Facebook User';
      const authorId = change.value?.from?.id || change.value?.sender_id || '';

      if (postId) {
        const existingMention = await prisma.facebookNotification.findFirst({
          where: {
            facebookPostId: postId,
            type: 'MESSAGE',
            createdAt: { gte: new Date(Date.now() - 60000) },
          },
        });
        if (existingMention) return;
      }

      const users = await prisma.user.findMany({
        where: { role: 'ADMIN', isActive: true },
      });

      for (const user of users) {
        try {
          const notification = await createNotification({
            type: Notification_type.FACEBOOK_MESSAGE,
            title: 'Page Mentioned',
            message: `${author} mentioned your page in a post: ${message.substring(0, 100) || 'No message'}`,
            userId: user.id,
            metadata: {
              pageId: integration.pageId,
              pageName: integration.pageName,
              postId,
              message,
              author,
              authorId,
              isMention: true,
              detectedVia: 'feed',
            },
            channels: ['IN_APP'],
          });

          await prisma.facebookNotification.create({
            data: {
              id: crypto.randomUUID(),
              type: 'MESSAGE',
              facebookId: postId || authorId || '',
              facebookPostId: postId || '',
              content: message,
              author,
              postUrl: postId ? `https://www.facebook.com/${postId}` : '',
              notificationId: notification.id,
            },
          });
        } catch (error: any) {
          console.error('[Facebook Webhook] Error creating mention notification:', error.message);
        }
      }
      return;
    }

    // Check deduplication
    if (postId) {
      const existingPost = await prisma.facebookNotification.findFirst({
        where: {
          OR: [
            { facebookPostId: postId, type: 'POST' },
            { facebookId: postId, type: 'POST' },
          ],
        },
      });
      if (existingPost) return;

      const recentComment = await prisma.facebookNotification.findFirst({
        where: {
          facebookPostId: postId,
          type: 'COMMENT',
          createdAt: { gte: new Date(Date.now() - 10000) },
        },
      });
      if (recentComment) return;
    }

    const users = await prisma.user.findMany({
      where: { role: 'ADMIN', isActive: true },
    });

    for (const user of users) {
      try {
        const notification = await createNotification({
          type: Notification_type.FACEBOOK_POST,
          title: 'New Facebook Post',
          message: `New post on your Facebook page: ${message.substring(0, 100) || 'No message'}`,
          userId: user.id,
          metadata: {
            pageId: integration.pageId,
            pageName: integration.pageName,
            postId,
            message,
            author: change.value?.from?.name || change.value?.author || 'Facebook User',
          },
          channels: ['IN_APP'],
        });

        await prisma.facebookNotification.create({
          data: {
            id: crypto.randomUUID(),
            type: 'POST',
            facebookId: postId || '',
            facebookPostId: postId || '',
            content: message,
            author: change.value?.from?.name || change.value?.author || 'Facebook User',
            postUrl: postId ? `https://www.facebook.com/${postId}` : '',
            notificationId: notification.id,
          },
        });
      } catch (error: any) {
        console.error('[Facebook Webhook] Error creating post notification:', error.message);
      }
    }
  }
}

export { router as webhookRouter };
