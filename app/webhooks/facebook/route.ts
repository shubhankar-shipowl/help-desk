import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { Notification_type } from '@prisma/client'
import { NotificationService } from '@/lib/notifications/NotificationService'
import { getSystemSetting } from '@/lib/system-settings'
import crypto from 'crypto'

const notificationService = new NotificationService()

// Facebook webhook verification endpoint
// Endpoint: GET /webhooks/facebook
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const mode = searchParams.get('hub.mode')
  const token = searchParams.get('hub.verify_token')
  const challenge = searchParams.get('hub.challenge')

  // Log verification request
  console.log('[Facebook Webhook Verification]', {
    mode,
    token: token ? '***' : null,
    challenge: challenge ? 'received' : null,
    userAgent: req.headers.get('user-agent'),
    origin: req.headers.get('origin'),
  })

  // For webhook verification, we need to check all tenants since we don't know which tenant this is for
  // Try to find a matching verify token in SystemSettings, or fallback to environment variable
  let verifyToken = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'fb_verify_2025'
  
  // Try to find verify token from any tenant's SystemSettings
  // This is a public endpoint, so we check all tenants
  try {
    const settings = await prisma.systemSettings.findMany({
      where: {
        key: 'FACEBOOK_WEBHOOK_VERIFY_TOKEN',
      },
    })
    
    // If we have settings, use the first one (or we could match by checking all)
    if (settings.length > 0) {
      verifyToken = settings[0].value || verifyToken
    }
  } catch (error) {
    // Fallback to environment variable if SystemSettings lookup fails
    console.warn('[Facebook Webhook] Could not fetch verify token from SystemSettings, using env var')
  }

  // Check if mode is "subscribe" and token matches
  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[Facebook Webhook Verification] ✅ Verified successfully')
    
    // Return challenge as plain text with HTTP 200
    // Important: Facebook requires plain text response, not JSON
    return new NextResponse(challenge || '', {
      status: 200,
      headers: {
        'Content-Type': 'text/plain',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    })
  }

  // Invalid verification
  console.log('[Facebook Webhook Verification] ❌ Verification failed', {
    modeMatch: mode === 'subscribe',
    tokenMatch: token === verifyToken,
    receivedMode: mode,
    receivedToken: token ? 'provided' : 'missing',
  })

  return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
}

// Facebook webhook event handler
// Endpoint: POST /webhooks/facebook
export async function POST(req: NextRequest) {
  try {
    // Log incoming request details
    console.log('[Facebook Webhook] ========================================')
    console.log('[Facebook Webhook] 📥 Incoming POST request')
    console.log('[Facebook Webhook] Headers:', {
      'content-type': req.headers.get('content-type'),
      'user-agent': req.headers.get('user-agent'),
      'x-forwarded-for': req.headers.get('x-forwarded-for'),
      origin: req.headers.get('origin'),
    })
    
    const body = await req.json()
    
    console.log('[Facebook Webhook] ========================================')
    console.log('[Facebook Webhook] 📥 Received webhook event')
    console.log('[Facebook Webhook] Full body:', JSON.stringify(body, null, 2))
    console.log('[Facebook Webhook] Object:', body.object)
    console.log('[Facebook Webhook] Has entry:', !!body.entry)
    console.log('[Facebook Webhook] Entry count:', body.entry?.length || 0)

    // Check if this is a test notification from Facebook
    if (body.object === 'page' && body.entry && body.entry.length > 0) {
      const firstEntry = body.entry[0]
      if (firstEntry.id === '0' || firstEntry.time) {
        console.log('[Facebook Webhook] 🧪 This appears to be a test notification')
      }
    }

    // Facebook sends entries array
    if (body.object === 'page' && body.entry) {
      console.log('[Facebook Webhook] ✅ Processing page webhook with', body.entry.length, 'entry/entries')
      
      for (const entry of body.entry) {
        // Try multiple ways to get page ID
        let pageId = entry.id || entry.page_id || entry.page?.id || body.entry?.[0]?.id
        
        // Check if this is a test notification (pageId is '0' or invalid)
        if (pageId === '0' || pageId === 0 || !pageId) {
          console.log('[Facebook Webhook] ⚠️ Invalid or test pageId detected:', pageId)
          pageId = null // Set to null to trigger fallback
        }
        
        console.log('[Facebook Webhook] Processing entry:', {
          pageId,
          entryId: entry.id,
          entryPageId: entry.page_id,
          entryPage: entry.page,
          hasMessaging: !!entry.messaging,
          hasChanges: !!entry.changes,
          messagingCount: entry.messaging?.length || 0,
          changesCount: entry.changes?.length || 0,
          allEntryKeys: Object.keys(entry),
        })
        
        // If pageId is invalid or not found, try to get it from all integrations
        let finalPageId = pageId
        if (!finalPageId || finalPageId === '0' || finalPageId === 0) {
          console.log('[Facebook Webhook] ⚠️ No valid pageId found in entry, checking all integrations...')
          const allIntegrations = await prisma.facebookIntegration.findMany({
            where: { isActive: true },
          })
          console.log('[Facebook Webhook] Active integrations:', allIntegrations.map(i => ({ pageId: i.pageId, pageName: i.pageName })))
          
          // If only one active integration, use it
          if (allIntegrations.length === 1) {
            finalPageId = allIntegrations[0].pageId
            console.log('[Facebook Webhook] ✅ Using single active integration pageId:', finalPageId)
          } else if (allIntegrations.length > 1) {
            console.log('[Facebook Webhook] ⚠️ Multiple active integrations found, using first one:', allIntegrations[0].pageId)
            finalPageId = allIntegrations[0].pageId
          } else {
            console.log('[Facebook Webhook] ❌ No active integrations found. Skipping webhook processing.')
            continue // Skip this entry if no integrations
          }
        }
        
        // Validate finalPageId before proceeding
        if (!finalPageId || finalPageId === '0' || finalPageId === 0) {
          console.log('[Facebook Webhook] ❌ Invalid finalPageId, skipping entry:', finalPageId)
          continue
        }

        // Handle messaging events (direct messages)
        if (entry.messaging && finalPageId) {
          for (const event of entry.messaging) {
            await handleFacebookMessage(event, finalPageId)
          }
        }

        // Handle feed changes (posts, comments)
        if (entry.changes && finalPageId) {
          console.log('[Facebook Webhook] ✅ Processing', entry.changes.length, 'change(s) for pageId:', finalPageId)
          for (const change of entry.changes) {
            // Log detailed change information for debugging
            const changeInfo = {
              field: change.field,
              item: change.value?.item,
              verb: change.value?.verb,
              hasCommentId: !!change.value?.comment_id,
              hasPostId: !!change.value?.post_id,
              commentId: change.value?.comment_id,
              postId: change.value?.post_id,
              hasValue: !!change.value,
            }
            console.log('[Facebook Webhook] Change item:', changeInfo)
            console.log('[Facebook Webhook] Full change:', JSON.stringify(change, null, 2))
            
            if (change.value) {
              try {
                await handleFacebookChange(change, finalPageId)
                console.log('[Facebook Webhook] ✅ Successfully processed change:', change.field, 'Item:', change.value?.item)
              } catch (changeError: any) {
                console.error('[Facebook Webhook] ❌ Error processing change:', changeError)
                console.error('[Facebook Webhook] Change that failed:', JSON.stringify(change, null, 2))
              }
            } else {
              console.log('[Facebook Webhook] ⚠️ Change has no value:', change)
            }
          }
        } else if (entry.changes && !finalPageId) {
          console.log('[Facebook Webhook] ⚠️ Cannot process changes: No pageId found')
          console.log('[Facebook Webhook] Entry:', JSON.stringify(entry, null, 2))
        } else if (!entry.changes) {
          console.log('[Facebook Webhook] ℹ️ No changes array in entry (this is normal for some event types)')
        }

        // Also check for standalone posts (not in changes)
        if (entry.messaging && entry.messaging.length === 0 && !entry.changes) {
          console.log('[Facebook Webhook] ⚠️ Entry has no messaging or changes - might be a different event type')
          console.log('[Facebook Webhook] Entry keys:', Object.keys(entry))
          console.log('[Facebook Webhook] Full entry:', JSON.stringify(entry, null, 2))
        }
        
        // Log if no events were processed
        if (!entry.messaging && !entry.changes) {
          console.log('[Facebook Webhook] ⚠️ WARNING: Entry has no messaging or changes!')
          console.log('[Facebook Webhook] This usually means:')
          console.log('[Facebook Webhook]   1. The "feed" field is NOT subscribed in Facebook')
          console.log('[Facebook Webhook]   2. Or Facebook is sending a different event structure')
          console.log('[Facebook Webhook] Full entry structure:', JSON.stringify(entry, null, 2))
        }
      }
    }

    // Log summary of what was processed
    const processedCount = body.entry?.length || 0
    console.log('[Facebook Webhook] ✅ Webhook processed successfully')
    console.log('[Facebook Webhook] Processed', processedCount, 'entry/entries')
    console.log('[Facebook Webhook] ========================================')
    
    return NextResponse.json({ 
      success: true,
      processed: processedCount,
      message: `Processed ${processedCount} entry/entries`
    }, { status: 200 })
  } catch (error: any) {
    console.error('[Facebook Webhook] ❌ Error processing webhook:', error)
    console.error('[Facebook Webhook] Error message:', error.message)
    console.error('[Facebook Webhook] Error stack:', error.stack)
    console.log('[Facebook Webhook] ========================================')
    
    // Return 200 to prevent Facebook from retrying (if it's a processing error)
    // Only return 500 for actual server errors
    return NextResponse.json(
      { 
        error: error.message || 'Failed to process webhook',
        success: false 
      },
      { status: 200 } // Return 200 so Facebook doesn't retry
    )
  }
}

async function handleFacebookMessage(event: any, pageId: string) {
  console.log('[Facebook Webhook] Handling message event:', { pageId, senderId: event.sender?.id })
  
  // Use findFirst since we don't have tenantId context in webhook
  const integration = await prisma.facebookIntegration.findFirst({
    where: { 
      pageId,
      isActive: true,
    },
  })

  if (!integration || !integration.isActive) {
    console.log('[Facebook Webhook] Integration not found or inactive:', { pageId, isActive: integration?.isActive })
    return
  }

  // Get all admin users to notify (agents should not receive Facebook notifications)
  const users = await prisma.user.findMany({
    where: { 
      role: 'ADMIN',
      isActive: true,
    },
  })

  console.log('[Facebook Webhook] Notifying admin users:', { userCount: users.length })

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
      include: {
        User_Notification_userIdToUser: {
          select: { id: true, name: true, email: true },
        },
      },
    })

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
        })

    // Emit real-time notification via WebSocket
    try {
      const { publishNotification } = await import('@/lib/notifications/pubsub')
      await publishNotification(notification)
      console.log('[Facebook Webhook] ✅ Published message notification via WebSocket')
    } catch (wsError: any) {
      console.error('[Facebook Webhook] ⚠️ Failed to publish via WebSocket:', wsError.message)
    }
  }

  console.log('[Facebook Webhook] ✅ Message notification created')
}

async function handleFacebookChange(change: any, pageId: string) {
  // Log full change structure for debugging
  console.log('[Facebook Webhook] ========================================')
  console.log('[Facebook Webhook] Handling change event:', {
    pageId,
    field: change.field,
    item: change.value?.item,
    verb: change.value?.verb,
    postId: change.value?.post_id,
    commentId: change.value?.comment_id,
    hasCommentId: !!change.value?.comment_id,
    hasPostId: !!change.value?.post_id,
  })
  console.log('[Facebook Webhook] Full change value:', JSON.stringify(change.value, null, 2))
  console.log('[Facebook Webhook] ========================================')

  // Check if pageId is invalid ('0' or empty)
  const isValidPageId = pageId && pageId !== '0' && String(pageId) !== '0'
  
  // If pageId is missing or invalid, try to find active integration
  let integration
  if (isValidPageId) {
    // Use findFirst since we don't have tenantId context in webhook
    integration = await prisma.facebookIntegration.findFirst({
      where: { 
        pageId,
        isActive: true,
      },
    })
    if (!integration) {
      console.log('[Facebook Webhook] ⚠️ Integration not found for pageId:', pageId, '- searching for active integration...')
    }
  } else {
    console.log('[Facebook Webhook] ⚠️ Invalid or missing pageId:', pageId, '- searching for active integration...')
  }
  
  // If no integration found or pageId is invalid, try to find active integration
  if (!integration || !isValidPageId) {
    const activeIntegrations = await prisma.facebookIntegration.findMany({
      where: { isActive: true },
    })
    
    if (activeIntegrations.length === 0) {
      console.log('[Facebook Webhook] ❌ No active integrations found. Skipping webhook processing.')
      const allIntegrations = await prisma.facebookIntegration.findMany()
      console.log('[Facebook Webhook] All integrations:', allIntegrations.map(i => ({ 
        pageId: i.pageId, 
        pageName: i.pageName, 
        isActive: i.isActive 
      })))
      return
    }
    
    if (activeIntegrations.length === 1) {
      integration = activeIntegrations[0]
      console.log('[Facebook Webhook] ✅ Using single active integration:', {
        pageId: integration.pageId,
        pageName: integration.pageName,
      })
    } else if (activeIntegrations.length > 1) {
      console.log('[Facebook Webhook] ⚠️ Multiple active integrations found, using first one:', activeIntegrations[0].pageId)
      integration = activeIntegrations[0]
    }
  }

  if (!integration || !integration.isActive) {
    console.log('[Facebook Webhook] ❌ Integration not found or inactive:', { 
      providedPageId: pageId,
      isValidPageId,
      integrationPageId: integration?.pageId,
      isActive: integration?.isActive,
      allIntegrations: await prisma.facebookIntegration.findMany().then(integrations => 
        integrations.map(i => ({ pageId: i.pageId, pageName: i.pageName, isActive: i.isActive }))
      ),
    })
    return
  }
  
  console.log('[Facebook Webhook] ✅ Found active integration:', {
    pageId: integration.pageId,
    pageName: integration.pageName,
    isActive: integration.isActive,
  })

  // Check for mentions FIRST (when page is mentioned in someone else's post)
  // Note: Facebook uses 'mention' (singular) field, not 'mentions'
  if (change.field === 'mention' || change.value?.item === 'mention') {
    console.log('[Facebook Webhook] ✅ CONFIRMED: This is a MENTION event')
    const postId = change.value?.post_id || change.value?.id
    const message = change.value?.message || change.value?.text || ''
    const author = change.value?.from?.name || change.value?.author || 'Facebook User'
    const authorId = change.value?.from?.id || change.value?.sender_id || ''
    
    console.log('[Facebook Webhook] 💬 Processing page mention:', {
      field: change.field,
      postId,
      message: message.substring(0, 50),
      author,
      authorId,
      fullValue: JSON.stringify(change.value, null, 2),
    })

    // Deduplication: Check if we've already processed this mention
    if (postId) {
      const existingNotification = await prisma.facebookNotification.findFirst({
        where: {
          facebookPostId: postId,
          type: 'MESSAGE', // Using MESSAGE type for mentions
          createdAt: {
            gte: new Date(Date.now() - 60000), // Within last minute
          },
        },
      })

      if (existingNotification) {
        console.log('[Facebook Webhook] ⚠️ DUPLICATE: Mention already processed:', postId)
        console.log('[Facebook Webhook] ⛔ SKIPPING: Will not create duplicate notification')
        return // Exit - already processed this mention
      }
    }

    // Only notify ADMIN users (agents should not receive Facebook notifications)
    const users = await prisma.user.findMany({
      where: { 
        role: 'ADMIN',
        isActive: true,
      },
    })

    if (users.length === 0) {
      console.log('[Facebook Webhook] ⚠️ No active admins found!')
      return
    }

    for (const user of users) {
      try {
        const notification = await notificationService.createNotification({
          type: Notification_type.FACEBOOK_MESSAGE, // Using MESSAGE type for mentions
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
        })

        await prisma.facebookNotification.create({
          data: {
            id: crypto.randomUUID(),
            type: 'MESSAGE', // Using MESSAGE type for mentions
            facebookId: postId || authorId || '',
            facebookPostId: postId || '',
            content: message,
            author,
            postUrl: postId ? `https://www.facebook.com/${postId}` : '',
            notificationId: notification.id,
          },
        })

        console.log('[Facebook Webhook] ✅ Created mention notification:', notification.id, 'for user:', user.email)
      } catch (error: any) {
        console.error('[Facebook Webhook] ❌ Error creating mention notification for user', user.id, ':', error)
      }
    }
    console.log('[Facebook Webhook] ✅ Mention notification created for', users.length, 'user(s)')
    console.log('[Facebook Webhook] ⛔ EXITING: Mention processed')
    return // Exit early - mention processed
  }

  // CRITICAL: Check for comments FIRST, before checking for posts
  // Comments on existing posts should be detected as comments, not posts
  // Facebook sends comments with: item === 'comment', verb === 'add', and comment_id
  // If comment_id exists, it's ALWAYS a comment, never a post
  const hasCommentId = !!change.value?.comment_id
  const isCommentItem = change.value?.item === 'comment'
  const isCommentVerb = change.value?.verb === 'add' && change.value?.item === 'comment'
  
  const isComment = 
    (change.field === 'feed' && hasCommentId) || // If comment_id exists, it's a comment
    (change.field === 'feed' && isCommentItem) || // If item is 'comment', it's a comment
    (change.field === 'feed' && isCommentVerb) // If verb is 'add' and item is 'comment'

  console.log('[Facebook Webhook] Comment detection check:', {
    field: change.field,
    hasCommentId,
    isCommentItem,
    isCommentVerb,
    isComment,
  })

  if (isComment) {
    console.log('[Facebook Webhook] ✅ CONFIRMED: This is a COMMENT event')
    const postId = change.value?.post_id
    const commentId = change.value?.comment_id
    const message = change.value?.message || ''
    const author = change.value?.from?.name || change.value?.author || 'Facebook User'
    
    console.log('[Facebook Webhook] 💬 Processing new comment:', {
      field: change.field,
      item: change.value?.item,
      verb: change.value?.verb,
      postId,
      commentId,
      message: message.substring(0, 50),
      author,
      fullValue: JSON.stringify(change.value, null, 2),
    })

    // Deduplication: Check if we've already processed this comment
    if (commentId) {
      const existingNotification = await prisma.facebookNotification.findFirst({
        where: {
          facebookId: commentId,
          type: 'COMMENT',
        },
      })

      if (existingNotification) {
        console.log('[Facebook Webhook] ⚠️ DUPLICATE: Comment already processed:', commentId)
        console.log('[Facebook Webhook] ⛔ SKIPPING: Will not create duplicate notification')
        return // Exit - already processed this comment
      }
    }

    // Only notify ADMIN users (agents should not receive Facebook notifications)
    const users = await prisma.user.findMany({
      where: { 
        role: 'ADMIN',
        isActive: true,
      },
    })

    console.log('[Facebook Webhook] Found', users.length, 'active admin user(s) to notify for comment')

    if (users.length === 0) {
      console.log('[Facebook Webhook] ⚠️ No active admins found!')
      return
    }

    for (const user of users) {
      try {
        // Use NotificationService for consistency and WebSocket publishing
        const notification = await notificationService.createNotification({
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
          channels: ['IN_APP'], // Only in-app notifications for Facebook events
        })

        console.log('[Facebook Webhook] ✅ Created comment notification via NotificationService:', notification.id, 'for user:', user.email)

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
        })

        console.log('[Facebook Webhook] ✅ Created FacebookNotification record for comment')
      } catch (error: any) {
        console.error('[Facebook Webhook] ❌ Error creating comment notification for user', user.id, ':', error)
        console.error('[Facebook Webhook] Error details:', error.message, error.stack)
      }
    }

    console.log('[Facebook Webhook] ✅ Comment notification created for', users.length, 'user(s)')
    console.log('[Facebook Webhook] ⛔ EXITING: Comment processed, will NOT process as post')
    return // CRITICAL: Return early to prevent processing as post
  }

  // Handle post creation (only if NOT a comment)
  // Note: Facebook sends different event structures for different post types
  // CRITICAL: Explicitly exclude comments - check for comment_id first
  // Posts should have: item === 'post' OR item === 'status', but NOT 'comment'
  // Posts should NOT have comment_id
  // If we reach here, it means isComment was false, but double-check anyway
  const hasCommentIdCheck = !!change.value?.comment_id
  const isCommentItemCheck = change.value?.item === 'comment'
  
  if (hasCommentIdCheck || isCommentItemCheck) {
    console.log('[Facebook Webhook] ⛔ BLOCKED: This has comment_id or is comment item - skipping post processing')
    console.log('[Facebook Webhook]    hasCommentId:', hasCommentIdCheck)
    console.log('[Facebook Webhook]    isCommentItem:', isCommentItemCheck)
    return // Exit - this is actually a comment that wasn't caught above
  }
  
  const isPost = 
    change.field === 'feed' && (
      change.value?.item === 'post' ||
      (change.value?.verb === 'add' && change.value?.item === 'post') ||
      change.value?.item === 'status' ||
      (change.value?.post_id && !change.value?.comment_id) ||
      (change.value?.id && !change.value?.comment_id && change.value?.item !== 'comment')
    )

  console.log('[Facebook Webhook] Post detection check:', {
    field: change.field,
    item: change.value?.item,
    verb: change.value?.verb,
    hasPostId: !!change.value?.post_id,
    hasCommentId: hasCommentIdCheck,
    isPost,
  })

  if (isPost) {
    // Triple-check: Make absolutely sure this is NOT a comment
    if (change.value?.comment_id || change.value?.item === 'comment') {
      console.log('[Facebook Webhook] ⚠️ BLOCKED: Skipping post processing - this is actually a comment:', {
        commentId: change.value?.comment_id,
        item: change.value?.item,
        verb: change.value?.verb,
      })
      console.log('[Facebook Webhook] ⛔ EXITING: Will not create post notification')
      return // Exit early - this is a comment, not a post
    }
    
    // Define variables once for the entire post processing block
    const postId = change.value?.post_id || change.value?.id
    const message = change.value?.message || change.value?.text || ''
    
    // Check if this post mentions/tags the page (alternative to 'mention' field)
    // Mentions in feed events might have: message_tags, story_tags, or mention data
    const messageTags = change.value?.message_tags || []
    const storyTags = change.value?.story_tags || {}
    const mentions = change.value?.mentions || []
      
      // Check if page is mentioned in tags or message
      const pageMentioned = 
        messageTags.some((tag: any) => tag.id === integration.pageId) ||
        Object.values(storyTags).some((tags: any) => 
          Array.isArray(tags) && tags.some((tag: any) => tag.id === integration.pageId)
        ) ||
        mentions.some((mention: any) => mention.id === integration.pageId) ||
        message.includes(`@${integration.pageName}`) ||
        message.includes(`facebook.com/${integration.pageId}`)
      
      if (pageMentioned) {
        console.log('[Facebook Webhook] ✅ DETECTED: Page mentioned in post!')
        console.log('[Facebook Webhook] 📝 Processing as mention (via feed field):', {
          postId,
          message: message.substring(0, 50),
          author: change.value?.from?.name || change.value?.author || 'Facebook User',
        })
        
        const author = change.value?.from?.name || change.value?.author || 'Facebook User'
        const authorId = change.value?.from?.id || change.value?.sender_id || ''
        
        // Check for duplicate mention notification
        if (postId) {
          const existingMention = await prisma.facebookNotification.findFirst({
            where: {
              facebookPostId: postId,
              type: 'MESSAGE',
              createdAt: {
                gte: new Date(Date.now() - 60000), // Within last minute
              },
            },
          })
          
          if (existingMention) {
            console.log('[Facebook Webhook] ⚠️ DUPLICATE: Mention already processed:', postId)
            return // Skip duplicate
          }
        }
        
        // Only notify ADMIN users (agents should not receive Facebook notifications)
        const users = await prisma.user.findMany({
          where: { 
            role: 'ADMIN',
            isActive: true,
          },
        })
        
        if (users.length > 0) {
          for (const user of users) {
            try {
              const notification = await notificationService.createNotification({
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
                  detectedVia: 'feed', // Indicates detected via feed field, not mention field
                },
                channels: ['IN_APP'],
              })
              
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
              })
              
              console.log('[Facebook Webhook] ✅ Created mention notification via feed detection')
            } catch (error: any) {
              console.error('[Facebook Webhook] ❌ Error creating mention notification:', error)
            }
          }
        }
        
        // Don't create regular post notification for mentions
        console.log('[Facebook Webhook] ⛔ EXITING: Mention processed, skipping post notification')
        return // Exit - mention processed, don't create post notification
      }
      
      console.log('[Facebook Webhook] ✅ CONFIRMED: This is a POST event (not a comment, not a mention)')

    // CRITICAL: Check if this post already exists in our database
    // If it exists, it's an OLD post - don't create "post created" notification
    // Only create notification for NEW posts (first time we see them)
    if (postId) {
      const existingPost = await prisma.facebookNotification.findFirst({
        where: {
          OR: [
            { facebookPostId: postId, type: 'POST' },
            { facebookId: postId, type: 'POST' },
          ],
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      if (existingPost) {
        console.log('[Facebook Webhook] ⚠️ BLOCKED: Post already exists in database:', postId)
        console.log('[Facebook Webhook]    Post was first seen at:', existingPost.createdAt)
        console.log('[Facebook Webhook] ⛔ SKIPPING: This is an OLD post, not a new one')
        console.log('[Facebook Webhook] ⛔ Will NOT create "post created" notification')
        return // Exit - this is an old post, don't notify again
      }

      // Also check if we recently processed a comment on this post
      // (This handles the case where Facebook sends both comment and post events)
      const recentComment = await prisma.facebookNotification.findFirst({
        where: {
          facebookPostId: postId,
          type: 'COMMENT',
          createdAt: {
            gte: new Date(Date.now() - 10000), // Within last 10 seconds
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      })

      if (recentComment) {
        console.log('[Facebook Webhook] ⚠️ BLOCKED: Recent comment found on this post:', postId)
        console.log('[Facebook Webhook]    Comment processed at:', recentComment.createdAt)
        console.log('[Facebook Webhook] ⛔ SKIPPING: This is likely a duplicate event for the comment')
        console.log('[Facebook Webhook] ⛔ Will NOT create post notification')
        return // Exit - this is likely a duplicate event related to the comment
      }
    }
    
    console.log('[Facebook Webhook] 📝 Processing new post:', {
      field: change.field,
      item: change.value?.item,
      verb: change.value?.verb,
      postId,
      hasCommentId: !!change.value?.comment_id,
      message: message.substring(0, 50),
      fullValue: JSON.stringify(change.value, null, 2),
    })

    // Only notify ADMIN users (agents should not receive Facebook notifications)
    const users = await prisma.user.findMany({
      where: { 
        role: 'ADMIN',
        isActive: true,
      },
    })

    console.log('[Facebook Webhook] Found', users.length, 'active admin user(s) to notify')

    if (users.length === 0) {
      console.log('[Facebook Webhook] ⚠️ No active admins found!')
      return
    }

    for (const user of users) {
      try {
        // Use NotificationService for consistency and WebSocket publishing
        const notification = await notificationService.createNotification({
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
          channels: ['IN_APP'], // Only in-app notifications for Facebook events
        })

        console.log('[Facebook Webhook] ✅ Created notification via NotificationService:', notification.id, 'for user:', user.email)

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
        })

        console.log('[Facebook Webhook] ✅ Created FacebookNotification record')
      } catch (error: any) {
        console.error('[Facebook Webhook] ❌ Error creating notification for user', user.id, ':', error)
        console.error('[Facebook Webhook] Error details:', error.message, error.stack)
      }
    }

    console.log('[Facebook Webhook] ✅ Post notification created for', users.length, 'user(s)')
  } else {
    // Log all feed events that aren't posts or comments for debugging
    if (change.field === 'feed') {
      console.log('[Facebook Webhook] ⚠️ Feed event but not recognized as post or comment:')
      console.log('[Facebook Webhook]    Field:', change.field)
      console.log('[Facebook Webhook]    Item:', change.value?.item)
      console.log('[Facebook Webhook]    Verb:', change.value?.verb)
      console.log('[Facebook Webhook]    Has comment_id:', !!change.value?.comment_id)
      console.log('[Facebook Webhook]    Has post_id:', !!change.value?.post_id)
      console.log('[Facebook Webhook]    Full value:', JSON.stringify(change.value, null, 2))
      console.log('[Facebook Webhook]    💡 This might be a different event type!')
    } else {
      console.log('[Facebook Webhook] ℹ️ Not a feed event. Field:', change.field)
    }
  }
}

