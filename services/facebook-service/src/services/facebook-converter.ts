import { prisma } from '../config/database';
import { Ticket_source, Ticket_priority, Ticket_status } from '../types/prisma-enums';
import crypto from 'crypto';

async function generateTicketNumberWithSequence(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}${day}`;

  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay);
  endOfDay.setDate(endOfDay.getDate() + 1);

  const count = await prisma.ticket.count({
    where: {
      createdAt: {
        gte: startOfDay,
        lt: endOfDay,
      },
      ticketNumber: {
        startsWith: `TKT-${dateStr}-`,
      },
    },
  });

  const sequence = String(count + 1).padStart(3, '0');
  return `TKT-${dateStr}-${sequence}`;
}

export async function convertFacebookNotificationToTicket(
  facebookNotificationId: string,
  options?: {
    assignedAgentId?: string;
    assignedTeamId?: string;
    priority?: Ticket_priority;
    categoryId?: string;
    tags?: string[];
    storeId?: string | null;
  }
) {
  const fbNotification = await prisma.facebookNotification.findUnique({
    where: { id: facebookNotificationId },
    include: {
      Notification: {
        include: {
          User_Notification_userIdToUser: true,
        },
      },
    },
  });

  if (!fbNotification) {
    throw new Error('Facebook notification not found');
  }

  if (fbNotification.converted) {
    throw new Error('Notification already converted to ticket');
  }

  let source: Ticket_source;
  switch (fbNotification.type) {
    case 'POST':
      source = Ticket_source.FACEBOOK_POST;
      break;
    case 'COMMENT':
      source = Ticket_source.FACEBOOK_COMMENT;
      break;
    case 'MESSAGE':
      source = Ticket_source.FACEBOOK_MESSAGE;
      break;
    default:
      source = Ticket_source.FACEBOOK_MESSAGE;
  }

  const authorName = fbNotification.author;
  const content = fbNotification.content;
  const postUrl = fbNotification.postUrl || '';

  const notificationUser = fbNotification.Notification?.User_Notification_userIdToUser;
  const tenantId = notificationUser?.tenantId;

  if (!tenantId) {
    throw new Error('Cannot determine tenant for Facebook notification');
  }

  let customer = await prisma.user.findFirst({
    where: {
      tenantId,
      OR: [
        { name: { contains: authorName } },
        { email: { contains: authorName.toLowerCase() } },
      ],
      role: 'CUSTOMER',
    },
  });

  if (!customer) {
    customer = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        tenantId,
        email: `facebook_${fbNotification.facebookId}@facebook.local`,
        name: authorName,
        role: 'CUSTOMER',
        isActive: true,
        updatedAt: new Date(),
      },
    });
  }

  let priority = options?.priority || detectPriority(content);

  const ticketNumber = await generateTicketNumberWithSequence();

  const dueDate = await calculateDueDate(priority, options?.assignedTeamId);

  const ticket = await prisma.ticket.create({
    data: {
      id: crypto.randomUUID(),
      tenantId,
      storeId: options?.storeId || null,
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
  });

  await prisma.facebookNotification.update({
    where: { id: facebookNotificationId },
    data: {
      converted: true,
      convertedTicketId: ticket.id,
    },
  });

  if (options?.tags && options.tags.length > 0) {
    for (const tagName of options.tags) {
      let tag = await prisma.tag.findFirst({
        where: { tenantId, name: tagName },
      });

      if (!tag) {
        tag = await prisma.tag.create({
          data: {
            id: crypto.randomUUID(),
            tenantId,
            name: tagName,
          },
        });
      }

      await prisma.ticketTag.create({
        data: {
          id: crypto.randomUUID(),
          ticketId: ticket.id,
          tagId: tag.id,
        },
      });
    }
  }

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
  });

  if (!ticket.assignedAgentId && !ticket.assignedTeamId) {
    await applyAutoAssignmentRules(ticket.id, content, tenantId);
  }

  return ticket;
}

function detectPriority(content: string): Ticket_priority {
  const urgentKeywords = ['urgent', 'emergency', 'critical', 'asap', 'immediately', 'angry', 'complaint', 'refund', 'cancel'];
  const highKeywords = ['important', 'issue', 'problem', 'broken', 'not working', 'error'];
  const lowKeywords = ['question', 'inquiry', 'info', 'information', 'just asking'];

  const lowerContent = content.toLowerCase();

  if (urgentKeywords.some(keyword => lowerContent.includes(keyword))) {
    return Ticket_priority.URGENT;
  }

  if (highKeywords.some(keyword => lowerContent.includes(keyword))) {
    return Ticket_priority.HIGH;
  }

  if (lowKeywords.some(keyword => lowerContent.includes(keyword))) {
    return Ticket_priority.LOW;
  }

  return Ticket_priority.NORMAL;
}

function extractFacebookProfileUrl(postUrl: string): string | null {
  try {
    const url = new URL(postUrl);
    const pathParts = url.pathname.split('/').filter(Boolean);

    if (pathParts.length > 0) {
      return `https://www.facebook.com/${pathParts[0]}`;
    }
  } catch (e) {
    // Invalid URL
  }

  return null;
}

async function calculateDueDate(priority: Ticket_priority, teamId?: string | null): Promise<Date | null> {
  let responseTimeMinutes = 1440;

  if (teamId) {
    const slaRule = await prisma.sLARule.findUnique({
      where: {
        teamId_priority: {
          teamId,
          priority,
        },
      },
    });

    if (slaRule && slaRule.isActive) {
      responseTimeMinutes = slaRule.responseTime;
    }
  }

  const defaultSLAs: Record<Ticket_priority, number> = {
    [Ticket_priority.URGENT]: 60,
    [Ticket_priority.HIGH]: 240,
    [Ticket_priority.NORMAL]: 1440,
    [Ticket_priority.LOW]: 2880,
  };

  if (!teamId) {
    responseTimeMinutes = defaultSLAs[priority] || 1440;
  }

  const dueDate = new Date();
  dueDate.setMinutes(dueDate.getMinutes() + responseTimeMinutes);

  return dueDate;
}

async function applyAutoAssignmentRules(ticketId: string, content: string, tenantId: string) {
  const rules = await prisma.autoAssignmentRule.findMany({
    where: {
      tenantId,
      isActive: true,
    },
    orderBy: { priority: 'desc' },
  });

  for (const rule of rules) {
    const conditions = rule.conditions as any;
    const actions = rule.actions as any;

    let matches = true;

    if (conditions.keywords && Array.isArray(conditions.keywords)) {
      const lowerContent = content.toLowerCase();
      matches = conditions.keywords.some((keyword: string) =>
        lowerContent.includes(keyword.toLowerCase())
      );
    }

    if (!matches) continue;

    const updateData: any = {};

    if (actions.assignToTeam) {
      updateData.assignedTeamId = actions.assignToTeam;
    }

    if (actions.assignToAgent) {
      updateData.assignedAgentId = actions.assignToAgent;
    }

    if (actions.setPriority) {
      updateData.priority = actions.setPriority;
    }

    if (actions.setCategory) {
      updateData.categoryId = actions.setCategory;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.ticket.update({
        where: { id: ticketId },
        data: updateData,
      });

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
      });

      break;
    }
  }
}
