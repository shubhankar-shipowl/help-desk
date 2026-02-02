import { prisma } from '@/lib/prisma'
import { Ticket_source, Ticket_priority, Ticket_status } from '@prisma/client'
import { generateTicketNumberWithSequence } from '@/lib/utils'
import crypto from 'crypto'

/**
 * Auto-convert Facebook notification to ticket
 */
export async function convertFacebookNotificationToTicket(
  facebookNotificationId: string,
  options?: {
    assignedAgentId?: string
    assignedTeamId?: string
    priority?: Ticket_priority
    categoryId?: string
    tags?: string[]
    storeId?: string | null // Add storeId option
  }
) {
  // Fetch Facebook notification with related data
  const fbNotification = await prisma.facebookNotification.findUnique({
    where: { id: facebookNotificationId },
    include: {
      Notification: {
        include: {
          User_Notification_userIdToUser: true,
        },
      },
    },
  })

  if (!fbNotification) {
    throw new Error('Facebook notification not found')
  }

  if (fbNotification.converted) {
    throw new Error('Notification already converted to ticket')
  }

  // Determine ticket source based on notification type
  let source: Ticket_source
  switch (fbNotification.type) {
    case 'POST':
      source = Ticket_source.FACEBOOK_POST
      break
    case 'COMMENT':
      source = Ticket_source.FACEBOOK_COMMENT
      break
    case 'MESSAGE':
      source = Ticket_source.FACEBOOK_MESSAGE
      break
    default:
      source = Ticket_source.FACEBOOK_MESSAGE
  }

  // Extract customer information
  const authorName = fbNotification.author
  const content = fbNotification.content
  const postUrl = fbNotification.postUrl || ''
  
  // Get tenantId from the notification's user (who received the notification)
  // This ensures Facebook tickets are created in the correct tenant
  const notificationUser = fbNotification.Notification?.User_Notification_userIdToUser
  const tenantId = notificationUser?.tenantId

  if (!tenantId) {
    throw new Error('Cannot determine tenant for Facebook notification')
  }

  // Try to find existing customer by name or create new one
  // MySQL doesn't support mode: 'insensitive', so we'll search case-insensitively using LOWER
  // For MySQL, we'll search without mode and let the database collation handle it
  let customer = await prisma.user.findFirst({
    where: {
      tenantId, // Multi-tenant: Filter by tenant
      OR: [
        { name: { contains: authorName } },
        { email: { contains: authorName.toLowerCase() } },
      ],
      role: 'CUSTOMER',
    },
  })

  // If customer not found, create a new customer
  if (!customer) {
    customer = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        tenantId, // Multi-tenant: Always include tenantId
        email: `facebook_${fbNotification.facebookId}@facebook.local`, // Placeholder email
        name: authorName,
        role: 'CUSTOMER',
        isActive: true,
        updatedAt: new Date(),
      },
    })
  }

  // Auto-detect priority based on content
  let priority = options?.priority || detectPriority(content)

  // Generate ticket number with sequence
  const ticketNumber = await generateTicketNumberWithSequence()

  // Calculate due date
  const dueDate = await calculateDueDate(priority, options?.assignedTeamId)

  // Create ticket
  const ticket = await prisma.ticket.create({
    data: {
      id: crypto.randomUUID(),
      tenantId, // Multi-tenant: Always include tenantId
      storeId: options?.storeId || null, // Assign to store if provided
      ticketNumber,
      subject: `Facebook ${fbNotification.type}: ${content.substring(0, 50)}${content.length > 50 ? '...' : ''}`,
      description: content,
      status: Ticket_status.NEW,
      priority,
      source,
      customerId: customer.id,
      assignedAgentId: options?.assignedAgentId || null,
      assignedTeamId: options?.assignedTeamId || null,
      categoryId: options?.categoryId || null,
      facebookPostUrl: postUrl,
      customerFacebookLink: fbNotification.postUrl ? extractFacebookProfileUrl(postUrl) : null,
      dueDate: dueDate,
      updatedAt: new Date(),
    },
    include: {
      User_Ticket_customerIdToUser: true,
      User_Ticket_assignedAgentIdToUser: true,
      Team: true,
      Category: true,
    },
  })

  // Update Facebook notification to mark as converted
  await prisma.facebookNotification.update({
    where: { id: facebookNotificationId },
    data: {
      converted: true,
      convertedTicketId: ticket.id,
    },
  })

  // Add tags if provided
  if (options?.tags && options.tags.length > 0) {
    for (const tagName of options.tags) {
      // Find or create tag
      let tag = await prisma.tag.findFirst({
        where: {
          tenantId, // Multi-tenant: Filter by tenant
          name: tagName,
        },
      })

      if (!tag) {
        tag = await prisma.tag.create({
          data: {
            id: crypto.randomUUID(),
            tenantId, // Multi-tenant: Always include tenantId
            name: tagName,
          },
        })
      }

      // Link tag to ticket
      await prisma.ticketTag.create({
        data: {
          id: crypto.randomUUID(),
          ticketId: ticket.id,
          tagId: tag.id,
        },
      })
    }
  }

  // Create activity log
  await prisma.ticketActivity.create({
    data: {
      id: crypto.randomUUID(),
      ticketId: ticket.id,
      action: 'ticket_created',
      description: `Ticket created from Facebook ${fbNotification.type.toLowerCase()}`,
      metadata: {
        facebookNotificationId: fbNotification.id,
        source: source,
      },
    },
  })

  // Apply auto-assignment rules if no agent/team assigned
  if (!ticket.assignedAgentId && !ticket.assignedTeamId) {
    await applyAutoAssignmentRules(ticket.id, content, tenantId)
  }

  return ticket
}

/**
 * Detect priority based on content keywords
 */
function detectPriority(content: string): Ticket_priority {
  const urgentKeywords = ['urgent', 'emergency', 'critical', 'asap', 'immediately', 'angry', 'complaint', 'refund', 'cancel']
  const highKeywords = ['important', 'issue', 'problem', 'broken', 'not working', 'error']
  const lowKeywords = ['question', 'inquiry', 'info', 'information', 'just asking']

  const lowerContent = content.toLowerCase()

  if (urgentKeywords.some(keyword => lowerContent.includes(keyword))) {
    return Ticket_priority.URGENT
  }

  if (highKeywords.some(keyword => lowerContent.includes(keyword))) {
    return Ticket_priority.HIGH
  }

  if (lowKeywords.some(keyword => lowerContent.includes(keyword))) {
    return Ticket_priority.LOW
  }

  return Ticket_priority.NORMAL
}

/**
 * Extract Facebook profile URL from post URL
 */
function extractFacebookProfileUrl(postUrl: string): string | null {
  try {
    // Try to extract profile ID from various Facebook URL formats
    const url = new URL(postUrl)
    const pathParts = url.pathname.split('/').filter(Boolean)
    
    if (pathParts.length > 0) {
      // Return base Facebook profile URL
      return `https://www.facebook.com/${pathParts[0]}`
    }
  } catch (e) {
    // Invalid URL, return null
  }
  
  return null
}

/**
 * Calculate due date based on priority and team SLA
 */
async function calculateDueDate(priority: Ticket_priority, teamId?: string | null): Promise<Date | null> {
  let responseTimeMinutes = 1440 // Default: 24 hours (1440 minutes)

  // Try to get SLA rule for team
  if (teamId) {
    const slaRule = await prisma.sLARule.findUnique({
      where: {
        teamId_priority: {
          teamId,
          priority,
        },
      },
    })

    if (slaRule && slaRule.isActive) {
      responseTimeMinutes = slaRule.responseTime
    }
  }

  // Default SLA times by priority (in minutes)
  const defaultSLAs: Record<Ticket_priority, number> = {
    [Ticket_priority.URGENT]: 60,    // 1 hour
    [Ticket_priority.HIGH]: 240,     // 4 hours
    [Ticket_priority.NORMAL]: 1440,  // 24 hours
    [Ticket_priority.LOW]: 2880,     // 48 hours
  }

  if (!teamId) {
    responseTimeMinutes = defaultSLAs[priority] || 1440
  }

  // Calculate due date
  const dueDate = new Date()
  dueDate.setMinutes(dueDate.getMinutes() + responseTimeMinutes)

  return dueDate
}

/**
 * Apply auto-assignment rules
 */
async function applyAutoAssignmentRules(ticketId: string, content: string, tenantId: string) {
  const rules = await prisma.autoAssignmentRule.findMany({
    where: {
      tenantId, // Multi-tenant: Filter by tenant
      isActive: true,
    },
    orderBy: { priority: 'desc' },
  })

  for (const rule of rules) {
    const conditions = rule.conditions as any
    const actions = rule.actions as any

    // Check if conditions match
    let matches = true

    // Check keyword conditions
    if (conditions.keywords && Array.isArray(conditions.keywords)) {
      const lowerContent = content.toLowerCase()
      matches = conditions.keywords.some((keyword: string) => 
        lowerContent.includes(keyword.toLowerCase())
      )
    }

    if (!matches) continue

    // Apply actions
    const updateData: any = {}

    if (actions.assignToTeam) {
      updateData.assignedTeamId = actions.assignToTeam
    }

    if (actions.assignToAgent) {
      updateData.assignedAgentId = actions.assignToAgent
    }

    if (actions.setPriority) {
      updateData.priority = actions.setPriority
    }

    if (actions.setCategory) {
      updateData.categoryId = actions.setCategory
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: updateData,
      })

      // Log activity
      await prisma.ticketActivity.create({
        data: {
          id: crypto.randomUUID(),
          ticketId,
          action: 'auto_assigned',
          description: `Auto-assigned via rule: ${rule.name}`,
          metadata: {
            ruleId: rule.id,
            ruleName: rule.name,
            actions: actions,
          },
        },
      })

      // Only apply first matching rule
      break
    }
  }
}


