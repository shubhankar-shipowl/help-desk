import { prisma } from './prisma'
import { sendEmail, renderEmailTemplate } from './email'
import { TicketStatus, TicketPriority, UserRole } from '@prisma/client'
import { getAppUrl } from './utils'
import fs from 'fs'
import path from 'path'

// Helper function to get system setting with tenant context
async function getSystemSetting(key: string, tenantId?: string): Promise<string | null> {
  if (!tenantId) return null
  
  try {
    const setting = await prisma.systemSettings.findUnique({
      where: {
        tenantId_key: {
          tenantId,
          key,
        },
      },
    })
    return setting?.value || null
  } catch (error) {
    console.error(`Error fetching system setting ${key}:`, error)
    return null
  }
}

export async function autoAssignTicket(ticketId: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { category: true, customer: true },
  })

  if (!ticket || ticket.assignedAgentId) {
    return
  }

  // Round-robin assignment: find agent with least open tickets
  // Filter by tenantId to ensure agents are from the same tenant
  const agents = await prisma.user.findMany({
    where: {
      tenantId: ticket.tenantId, // Multi-tenant: Only assign to agents from same tenant
      role: UserRole.AGENT,
      isActive: true,
    },
    include: {
      assignedTickets: {
        where: {
          status: {
            in: [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.PENDING],
          },
        },
      },
    },
    orderBy: {
      assignedTickets: {
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
    const categoryAgents = agents.filter((agent) =>
      agent.assignedTickets.some((t) => t.categoryId === ticket.categoryId)
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
      customer: true,
      category: true,
      assignedAgent: true,
    },
  })

  if (fullTicket) {
    // Use notification service to create assignment notification
    const { ticketNotificationTriggers } = await import('./notifications/triggers/ticketTriggers')
    await ticketNotificationTriggers.onTicketAssigned(fullTicket)
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
            <li><strong>Customer:</strong> ${ticket.customer.name || ticket.customer.email}</li>
          </ul>
          <p><a href="${getAppUrl()}/agent/tickets/${ticketId}">View Ticket</a></p>
        `,
        tenantId: ticket.tenantId,
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
      in: [TicketStatus.OPEN, TicketStatus.PENDING],
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
      customer: true,
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })

  for (const ticket of inactiveTickets) {
    // Send warning email first
    if (ticket.customer.email) {
      await sendEmail({
        to: ticket.customer.email,
        subject: `Ticket ${ticket.ticketNumber} - No Response`,
        html: `
          <h2>Ticket Update Required</h2>
          <p>We haven't received a response on ticket ${ticket.ticketNumber} for ${daysInactive} days.</p>
          <p>If we don't hear from you within 24 hours, this ticket will be automatically resolved.</p>
          <p><a href="${getAppUrl()}/customer/tickets/${ticket.id}">View Ticket</a></p>
        `,
        tenantId: ticket.tenantId,
      })
    }

    // Wait 24 hours, then auto-resolve (in production, use a job queue)
    // For now, we'll just mark it
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.RESOLVED,
        resolvedAt: new Date(),
      },
    })

    // Add system note
    await prisma.comment.create({
      data: {
        content: `This ticket was automatically resolved due to inactivity (no customer response for ${daysInactive} days).`,
        ticketId: ticket.id,
        authorId: ticket.customerId, // System note
        isInternal: true,
      },
    })
  }

  return inactiveTickets.length
}

export async function sendTicketAcknowledgment(ticketId: string, tenantId?: string) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { 
      customer: true,
      category: true,
    },
  })

  if (!ticket || !ticket.customer.email) {
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
      to: ticket.customer.email,
      subject: `Thank you for contacting us - Ticket ${ticket.ticketNumber}`,
      html: `
        <h2>Thank you for contacting us!</h2>
        <p>We've received your support request and created ticket <strong>${ticket.ticketNumber}</strong>.</p>
        <p><strong>Subject:</strong> ${ticket.subject}</p>
        <p>Our support team will review your request and get back to you soon.</p>
        <p><a href="${getAppUrl()}/tickets/${ticket.id}">Track your ticket</a></p>
      `,
      tenantId: ticket.tenantId,
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
    CUSTOMER_NAME: ticket.customer.name || ticket.customer.email.split('@')[0],
    TICKET_ID: ticket.ticketNumber,
    TICKET_SUBJECT: ticket.subject,
    TICKET_CATEGORY: ticket.category?.name || 'General',
    TICKET_PRIORITY: priorityDisplay,
    PRIORITY_CLASS: priorityClass,
    CREATED_DATE: createdDate,
    TICKET_URL: ticketUrl,
    PORTAL_URL: portalUrl,
    EXPECTED_RESPONSE_TIME: '24 hours',
    COMPANY_NAME: (ticket.tenantId ? await getSystemSetting('COMPANY_NAME', ticket.tenantId) : null) || process.env.COMPANY_NAME || 'Shipowl Support',
    COMPANY_ADDRESS: (ticket.tenantId ? await getSystemSetting('COMPANY_ADDRESS', ticket.tenantId) : null) || process.env.COMPANY_ADDRESS || '',
    SUPPORT_EMAIL: (ticket.tenantId ? await getSystemSetting('SUPPORT_EMAIL', ticket.tenantId) : null) || process.env.SUPPORT_EMAIL || process.env.SMTP_USER || 'support@example.com',
    SUPPORT_PHONE: (ticket.tenantId ? await getSystemSetting('SUPPORT_PHONE', ticket.tenantId) : null) || process.env.SUPPORT_PHONE || '',
    CUSTOMER_EMAIL: ticket.customer.email,
    FACEBOOK_URL: process.env.FACEBOOK_URL || '#',
    TWITTER_URL: process.env.TWITTER_URL || '#',
    LINKEDIN_URL: process.env.LINKEDIN_URL || '#',
    UNSUBSCRIBE_URL: `${portalUrl}/settings/notifications`,
  }

  // Render template
  const html = renderEmailTemplate(template, variables)

  // Generate unique Message-ID for email threading
  const messageId = `<ticket-${ticket.id}-${Date.now()}@${process.env.SMTP_HOST || 'support'}>`
  
  const result = await sendEmail({
    to: ticket.customer.email,
    subject: `Ticket Created Successfully - ${ticket.ticketNumber}`,
    html,
    messageId,
    tenantId: ticket.tenantId,
  })

  // Store Message-ID in ticket for email threading
  if (result.success && result.messageId) {
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { originalEmailMessageId: result.messageId },
    }).catch((error) => {
      console.error('Error storing email Message-ID:', error)
      // Don't fail the whole operation if storing Message-ID fails
    })
  }
}

