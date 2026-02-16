import nodemailer from 'nodemailer'
import { prisma } from './prisma'

/**
 * Function to get SMTP config from SystemSettings or environment variables
 * 
 * IMPORTANT: This function uses tenantId and optionally storeId to fetch SMTP configuration.
 * Store-specific settings take precedence over tenant-level settings.
 * 
 * @param tenantId - The tenant ID
 * @param storeId - Optional store ID for store-specific SMTP configuration
 * @returns SMTP configuration object
 */
async function getSmtpConfig(tenantId?: string, storeId?: string | null) {
  let smtpHost = process.env.SMTP_HOST
  let smtpPort = process.env.SMTP_PORT || '587'
  let smtpUser = process.env.SMTP_USER
  let smtpPassword = process.env.SMTP_PASSWORD

  // If tenantId is provided, try to get from SystemSettings first
  // Try store-specific settings first, then fall back to tenant-level settings
  if (tenantId) {
    try {
      // Build where clause - try store-specific first, then tenant-level
      const where: any = {
        tenantId,
        key: {
          in: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'],
        },
      }

      // If storeId is provided, try store-specific settings first
      if (storeId) {
        const storeSettings = await prisma.systemSettings.findMany({
          where: {
            ...where,
            storeId,
          },
        })

        if (storeSettings.length > 0) {
          const settingsMap: Record<string, string> = {}
          storeSettings.forEach((setting) => {
            settingsMap[setting.key] = setting.value
          })

          smtpHost = settingsMap.SMTP_HOST || smtpHost
          smtpPort = settingsMap.SMTP_PORT || smtpPort
          smtpUser = settingsMap.SMTP_USER || smtpUser
          smtpPassword = settingsMap.SMTP_PASSWORD || smtpPassword
        }
      }

      // If no store-specific settings found, try tenant-level settings
      if (!storeId || !smtpHost || !smtpUser || !smtpPassword) {
        const tenantSettings = await prisma.systemSettings.findMany({
          where: {
            ...where,
            storeId: null,
          },
        })

        const settingsMap: Record<string, string> = {}
        tenantSettings.forEach((setting) => {
          settingsMap[setting.key] = setting.value
        })

        smtpHost = settingsMap.SMTP_HOST || smtpHost
        smtpPort = settingsMap.SMTP_PORT || smtpPort
        smtpUser = settingsMap.SMTP_USER || smtpUser
        smtpPassword = settingsMap.SMTP_PASSWORD || smtpPassword
      }
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
async function createTransporter(tenantId?: string, storeId?: string | null) {
  const config = await getSmtpConfig(tenantId, storeId)
  
  if (!config.host || !config.auth?.user || !config.auth?.pass) {
    console.warn(`[Email] SMTP configuration incomplete for tenant ${tenantId || 'default'}, store ${storeId || 'default'}. Emails may not send.`)
    return null // Return null if config is incomplete
  }
  
  // For Gmail, ensure we're using the correct settings
  const isGmail = config.host?.includes('gmail.com')
  const transporterConfig: any = {
    ...config,
  }
  
  // Gmail-specific settings
  if (isGmail) {
    transporterConfig.service = 'gmail'
    // Remove host/port for Gmail service
    delete transporterConfig.host
    delete transporterConfig.port
    // Ensure secure is false for Gmail (it uses STARTTLS)
    transporterConfig.secure = false
    transporterConfig.requireTLS = true
  }
  
  return nodemailer.createTransport(transporterConfig)
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
  storeId,
}: {
  to: string
  subject: string
  html?: string
  text?: string
  inReplyTo?: string
  references?: string
  messageId?: string
  tenantId?: string
  storeId?: string | null
}) {
  try {
    // Get SMTP config (from SystemSettings if tenantId provided, else from env)
    const smtpConfig = await getSmtpConfig(tenantId, storeId)
    const emailTransporter = await createTransporter(tenantId, storeId)
    
    if (!emailTransporter) {
      const errorMsg = `Email transporter not configured for tenant ${tenantId || 'default'}, store ${storeId || 'default'}. Please configure SMTP settings.`
      console.error(`[Email] ${errorMsg}`)
      return { success: false, error: new Error(errorMsg) }
    }

    // Validate SMTP credentials
    if (!smtpConfig.auth?.user || !smtpConfig.auth?.pass) {
      const errorMsg = 'SMTP credentials are missing. Please configure SMTP username and password.'
      console.error(`[Email] ${errorMsg}`)
      return { success: false, error: new Error(errorMsg) }
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

    // Verify connection before sending
    try {
      await emailTransporter.verify()
    } catch (verifyError: any) {
      console.error('[Email] SMTP connection verification failed:', verifyError)
      
      // Provide helpful error messages for common Gmail issues
      if (verifyError.code === 'EAUTH') {
        const isGmail = smtpConfig.host?.includes('gmail.com') || smtpConfig.auth?.user?.includes('@gmail.com')
        if (isGmail) {
          const errorMsg = 'Gmail authentication failed. Please ensure:\n' +
            '1. You are using an App Password (not your regular Gmail password)\n' +
            '2. 2-Step Verification is enabled on your Google account\n' +
            '3. You have generated an App Password at: https://myaccount.google.com/apppasswords\n' +
            '4. The App Password is correctly entered in SMTP settings'
          console.error(`[Email] ${errorMsg}`)
          return { success: false, error: new Error(errorMsg) }
        }
      }
      
      return { success: false, error: verifyError }
    }

    const result = await emailTransporter.sendMail(mailOptions)
    
    console.log(`[Email] ✅ Email sent successfully to ${to}`)
    return { 
      success: true, 
      messageId: result.messageId || emailMessageId 
    }
  } catch (error: any) {
    console.error('[Email] Error sending email:', error)
    
    // Provide helpful error messages
    if (error.code === 'EAUTH') {
      const isGmail = error.response?.includes('gmail.com') || error.response?.includes('gsmtp')
      if (isGmail) {
        const errorMsg = 'Gmail authentication failed. Please check:\n' +
          '1. You are using an App Password (not your regular password)\n' +
          '2. Generate an App Password at: https://myaccount.google.com/apppasswords\n' +
          '3. Make sure 2-Step Verification is enabled\n' +
          '4. Use the 16-character App Password in SMTP settings'
        return { success: false, error: new Error(errorMsg) }
      }
      return { success: false, error: new Error('SMTP authentication failed. Please check your username and password.') }
    }
    
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

