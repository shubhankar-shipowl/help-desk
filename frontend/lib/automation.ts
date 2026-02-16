import { prisma } from './prisma'
import { sendEmail, renderEmailTemplate } from './email'
import { Ticket_status, Ticket_priority, User_role } from '@prisma/client'
import { getAppUrl } from './utils'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

// Helper function to get system setting with tenant context
// Tries store-specific setting first, then falls back to tenant-level setting
async function getSystemSetting(key: string, tenantId?: string, storeId?: string | null): Promise<string | null> {
  if (!tenantId) return null
  
  try {
    // First try to find store-specific setting if storeId is provided
    if (storeId) {
      const storeSetting = await prisma.systemSettings.findFirst({
        where: {
          tenantId,
          storeId,
          key,
        },
      })
      if (storeSetting) {
        return storeSetting.value || null
      }
    }
    
    // Fall back to tenant-level setting (where storeId is null)
    const tenantSetting = await prisma.systemSettings.findFirst({
      where: {
        tenantId,
        storeId: null,
        key,
      },
    })
    return tenantSetting?.value || null
  } catch (error) {
    console.error(`Error fetching system setting ${key}:`, error)
    return null
  }
}

export async function autoAssignTicket(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { Category: true, User_Ticket_customerIdToUser: true },
  })

  if (!ticket || ticket.assignedAgentId) {
    return
  }

  // Round-robin assignment: find agent with least open tickets
  // Filter by tenantId to ensure agents are from the same tenant
  const agents = await prisma.user.findMany({
    where: {
      tenantId: ticket.tenantId, // Multi-tenant: Only assign to agents from same tenant
      role: User_role.AGENT,
      isActive: true,
    },
    include: {
      Ticket_Ticket_assignedAgentIdToUser: {
        where: {
          status: {
            in: [Ticket_status.NEW, Ticket_status.OPEN, Ticket_status.PENDING],
          },
        },
      },
    },
    orderBy: {
      Ticket_Ticket_assignedAgentIdToUser: {
        _count: 'asc',
      },
    },
  })

  if (agents.length === 0) {
    return
  }

  // If category has assigned agents, prefer them
  let selectedAgent = agents[0]
  if (ticket.categoryId) {
    const categoryAgents = agents.filter((agent: any) =>
      agent.Ticket_Ticket_assignedAgentIdToUser.some((t: any) => t.categoryId === ticket.categoryId)
    )
    if (categoryAgents.length > 0) {
      selectedAgent = categoryAgents[0]
    }
  }

  await prisma.ticket.update({
    where: { id: ticketId },
    data: { assignedAgentId: selectedAgent.id },
  })

  // Fetch full ticket with relations
  const fullTicket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      User_Ticket_customerIdToUser: true,
      Category: true,
      User_Ticket_assignedAgentIdToUser: true,
    },
  })

  if (fullTicket) {
    // Trigger assignment notification via notification service (non-blocking)
    const { triggerTicketAssigned } = await import('./notification-client')
    triggerTicketAssigned(ticketId).catch(err => console.error('[Automation] Assignment notification failed:', err))
  }

  // Send email notification
  if (selectedAgent.email) {
    try {
      await sendEmail({
        to: selectedAgent.email,
        subject: `New Ticket Assigned: ${ticket.ticketNumber}`,
        html: `
          <h2>New Ticket Assigned</h2>
          <p>You have been assigned a new ticket:</p>
          <ul>
            <li><strong>Ticket:</strong> ${ticket.ticketNumber}</li>
            <li><strong>Subject:</strong> ${ticket.subject}</li>
            <li><strong>Customer:</strong> ${ticket.User_Ticket_customerIdToUser.name || ticket.User_Ticket_customerIdToUser.email}</li>
          </ul>
          <p><a href="${getAppUrl()}/agent/tickets/${ticketId}">View Ticket</a></p>
        `,
        tenantId: ticket.tenantId,
        storeId: ticket.storeId || null,
      })
    } catch (error) {
      console.error('Error sending email notification:', error)
    }
  }

  return selectedAgent
}

export async function autoResolveInactiveTickets(daysInactive: number = 7, tenantId?: string) {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - daysInactive)

  const where: any = {
    status: {
      in: [Ticket_status.OPEN, Ticket_status.PENDING],
    },
    updatedAt: {
      lt: cutoffDate,
    },
    comments: {
      none: {
        createdAt: {
          gte: cutoffDate,
        },
        isInternal: false,
      },
    },
  }

  // Multi-tenant: Filter by tenantId if provided
  if (tenantId) {
    where.tenantId = tenantId
  }

  const inactiveTickets = await prisma.ticket.findMany({
    where,
    include: {
      User_Ticket_customerIdToUser: true,
      Comment: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  for (const ticket of inactiveTickets) {
    // Send warning email first
    if (ticket.User_Ticket_customerIdToUser.email) {
      await sendEmail({
        to: ticket.User_Ticket_customerIdToUser.email,
        subject: `Ticket ${ticket.ticketNumber} - No Response`,
        html: `
          <h2>Ticket Update Required</h2>
          <p>We haven't received a response on ticket ${ticket.ticketNumber} for ${daysInactive} days.</p>
          <p>If we don't hear from you within 24 hours, this ticket will be automatically resolved.</p>
          <p><a href="${getAppUrl()}/customer/tickets/${ticket.id}">View Ticket</a></p>
        `,
        tenantId: ticket.tenantId,
        storeId: ticket.storeId || null,
      })
    }

    // Wait 24 hours, then auto-resolve (in production, use a job queue)
    // For now, we'll just mark it
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: Ticket_status.RESOLVED,
        resolvedAt: new Date(),
      },
    })

    // Add system note
    await prisma.comment.create({
      data: {
        id: crypto.randomUUID(),
        content: `This ticket was automatically resolved due to inactivity (no customer response for ${daysInactive} days).`,
        ticketId: ticket.id,
        authorId: ticket.customerId, // System note
        isInternal: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    })
  }

  return inactiveTickets.length
}

export async function sendTicketAcknowledgment(ticketId: string, options?: { inReplyTo?: string }) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { 
      User_Ticket_customerIdToUser: true,
      Category: true,
    },
  })

  if (!ticket || !ticket.User_Ticket_customerIdToUser.email) {
    return
  }

  // Load email template
  const templatePath = path.join(process.cwd(), 'lib', 'templates', 'ticket-created.html')
  let template = ''
  
  try {
    template = fs.readFileSync(templatePath, 'utf-8')
  } catch (error) {
    console.error('Error reading email template:', error)
    // Fallback to simple email if template not found
    await sendEmail({
      to: ticket.User_Ticket_customerIdToUser.email,
      subject: `Thank you for contacting us - Ticket ${ticket.ticketNumber}`,
      html: `
        <h2>Thank you for contacting us!</h2>
        <p>We've received your support request and created ticket <strong>${ticket.ticketNumber}</strong>.</p>
        <p><strong>Subject:</strong> ${ticket.subject}</p>
        <p>Our support team will review your request and get back to you soon.</p>
        <p><a href="${getAppUrl()}/tickets/${ticket.id}">Track your ticket</a></p>
      `,
      tenantId: ticket.tenantId,
      storeId: ticket.storeId || null,
    })
    return
  }

  // Format date
  const createdDate = new Date(ticket.createdAt).toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  // Get priority badge class
  const priorityClassMap: Record<string, string> = {
    LOW: 'low',
    NORMAL: 'normal',
    HIGH: 'high',
    URGENT: 'urgent',
  }
  const priorityClass = priorityClassMap[ticket.priority] || 'normal'

  // Format priority display name
  const priorityDisplay = ticket.priority.charAt(0) + ticket.priority.slice(1).toLowerCase()

  // Determine ticket URL (public or authenticated)
  const appUrl = getAppUrl()
  const ticketUrl = `${appUrl}/tickets/${ticket.id}`
  const portalUrl = appUrl

  // Prepare template variables
  const variables: Record<string, string> = {
    CUSTOMER_NAME: ticket.User_Ticket_customerIdToUser.name || ticket.User_Ticket_customerIdToUser.email.split('@')[0],
    TICKET_ID: ticket.ticketNumber,
    TICKET_SUBJECT: ticket.subject,
    TICKET_CATEGORY: ticket.Category?.name || 'General',
    TICKET_PRIORITY: priorityDisplay,
    PRIORITY_CLASS: priorityClass,
    CREATED_DATE: createdDate,
    TICKET_URL: ticketUrl,
    PORTAL_URL: portalUrl,
    EXPECTED_RESPONSE_TIME: '24 hours',
    COMPANY_NAME: (ticket.tenantId ? await getSystemSetting('COMPANY_NAME', ticket.tenantId, ticket.storeId) : null) || process.env.COMPANY_NAME || 'Shipowl Support',
    COMPANY_ADDRESS: (ticket.tenantId ? await getSystemSetting('COMPANY_ADDRESS', ticket.tenantId, ticket.storeId) : null) || process.env.COMPANY_ADDRESS || '',
    SUPPORT_EMAIL: (ticket.tenantId ? await getSystemSetting('SUPPORT_EMAIL', ticket.tenantId, ticket.storeId) : null) || process.env.SUPPORT_EMAIL || process.env.SMTP_USER || 'support@example.com',
    SUPPORT_PHONE: (ticket.tenantId ? await getSystemSetting('SUPPORT_PHONE', ticket.tenantId, ticket.storeId) : null) || process.env.SUPPORT_PHONE || '',
    CUSTOMER_EMAIL: ticket.User_Ticket_customerIdToUser.email,
    FACEBOOK_URL: process.env.FACEBOOK_URL || '#',
    TWITTER_URL: process.env.TWITTER_URL || '#',
    LINKEDIN_URL: process.env.LINKEDIN_URL || '#',
    UNSUBSCRIBE_URL: `${portalUrl}/settings/notifications`,
  }

  // Render template
  const html = renderEmailTemplate(template, variables)

  // Generate unique Message-ID for email threading
  const messageId = `<ticket-${ticket.id}-${Date.now()}@${process.env.SMTP_HOST || 'support'}>`
  
  // Always use consistent subject format with ticket number
  // Threading is handled by In-Reply-To and References headers, not subject
  const emailSubject = `Ticket Created Successfully - ${ticket.ticketNumber}`
  
  const result = await sendEmail({
    to: ticket.User_Ticket_customerIdToUser.email,
    subject: emailSubject,
    html,
    messageId,
    inReplyTo: options?.inReplyTo,
    references: options?.inReplyTo,
    tenantId: ticket.tenantId,
    storeId: ticket.storeId || null,
  })

  // Store Message-ID in ticket for email threading
  if (result.success && result.messageId) {
    console.log(`[sendTicketAcknowledgment] 📧 Storing Message-ID for threading:`, {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      messageId: result.messageId,
    })
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { originalEmailMessageId: result.messageId },
    }).catch((error) => {
      console.error('Error storing email Message-ID:', error)
      // Don't fail the whole operation if storing Message-ID fails
    })
  } else {
    console.warn(`[sendTicketAcknowledgment] ⚠️ Could not store Message-ID:`, {
      ticketId: ticket.id,
      success: result.success,
      messageId: result.messageId,
    })
  }
}

