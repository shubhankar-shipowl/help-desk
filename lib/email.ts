import nodemailer from 'nodemailer'
import { prisma } from './prisma'

/**
 * Function to get SMTP config from SystemSettings or environment variables
 * 
 * IMPORTANT: This function uses tenantId to fetch tenant-specific SMTP configuration.
 * Since agents are created with the same tenantId as the admin who created them,
 * they automatically share the same SMTP configuration. When an admin configures
 * SMTP settings in the Integration page, those settings are stored in SystemSettings
 * with the tenantId, and all users (admin and agents) in that tenant will use
 * the same SMTP configuration for sending emails.
 * 
 * @param tenantId - The tenant ID (shared by admin and all agents in that tenant)
 * @returns SMTP configuration object
 */
async function getSmtpConfig(tenantId?: string) {
  let smtpHost = process.env.SMTP_HOST
  let smtpPort = process.env.SMTP_PORT || '587'
  let smtpUser = process.env.SMTP_USER
  let smtpPassword = process.env.SMTP_PASSWORD

  // If tenantId is provided, try to get from SystemSettings first
  // This ensures that all users (admin and agents) in the same tenant
  // use the SMTP configuration set by the admin in the Integration page
  if (tenantId) {
    try {
      const settings = await prisma.systemSettings.findMany({
        where: {
          tenantId,
          key: {
            in: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'],
          },
        },
      })

      const settingsMap: Record<string, string> = {}
      settings.forEach((setting) => {
        settingsMap[setting.key] = setting.value
      })

      smtpHost = settingsMap.SMTP_HOST || smtpHost
      smtpPort = settingsMap.SMTP_PORT || smtpPort
      smtpUser = settingsMap.SMTP_USER || smtpUser
      smtpPassword = settingsMap.SMTP_PASSWORD || smtpPassword
    } catch (error) {
      console.error('Error fetching SMTP config from SystemSettings:', error)
      // Fallback to environment variables
    }
  }

  return {
    host: smtpHost,
    port: parseInt(smtpPort || '587'),
    secure: parseInt(smtpPort || '587') === 465, // Use SSL for port 465, TLS for others
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  }
}

// Create transporter function that can be called with tenantId
async function createTransporter(tenantId?: string) {
  const config = await getSmtpConfig(tenantId)
  
  if (!config.host || !config.auth?.user || !config.auth?.pass) {
    console.warn(`[Email] SMTP configuration incomplete for tenant ${tenantId || 'default'}. Emails may not send.`)
    return null // Return null if config is incomplete
  }
  
  return nodemailer.createTransport(config)
}

// Default transporter (for backward compatibility)
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
})

export async function sendEmail({
  to,
  subject,
  html,
  text,
  inReplyTo,
  references,
  messageId,
  tenantId,
}: {
  to: string
  subject: string
  html?: string
  text?: string
  inReplyTo?: string
  references?: string
  messageId?: string
  tenantId?: string
}) {
  try {
    // Get SMTP config (from SystemSettings if tenantId provided, else from env)
    const smtpConfig = await getSmtpConfig(tenantId)
    const emailTransporter = tenantId ? await createTransporter(tenantId) : await createTransporter()
    
    if (!emailTransporter) {
      console.error(`[Email] Failed to create email transporter for tenant ${tenantId || 'default'}.`)
      return { success: false, error: new Error('Email transporter not configured.') }
    }
    
    // Generate Message-ID if not provided
    const emailMessageId = messageId || `<${Date.now()}-${Math.random().toString(36).substring(7)}@${smtpConfig.host || 'support'}>`
    
    const mailOptions: any = {
      from: smtpConfig.auth?.user || process.env.SMTP_USER,
      to,
      subject,
      messageId: emailMessageId,
    }

    // Use text if provided (for simple/raw emails), otherwise use html
    if (text) {
      mailOptions.text = text
    } else if (html) {
      mailOptions.html = html
    }

    // Add email threading headers if replying
    if (inReplyTo) {
      mailOptions.inReplyTo = inReplyTo
      mailOptions.references = references || inReplyTo
      console.log(`[Email] 📧 Email threading headers added:`, {
        inReplyTo,
        references: references ? references.substring(0, 100) + (references.length > 100 ? '...' : '') : 'none',
        subject,
      })
    }

    const result = await emailTransporter.sendMail(mailOptions)
    
    return { 
      success: true, 
      messageId: result.messageId || emailMessageId 
    }
  } catch (error) {
    console.error('Error sending email:', error)
    return { success: false, error }
  }
}

export function renderEmailTemplate(template: string, variables: Record<string, string>) {
  let rendered = template
  Object.entries(variables).forEach(([key, value]) => {
    rendered = rendered.replace(new RegExp(`{{${key}}}`, 'g'), value)
  })
  return rendered
}

