import nodemailer from 'nodemailer'
import { prisma } from '../config/database'

async function getSmtpConfig(tenantId?: string, storeId?: string | null) {
  let smtpHost = process.env.SMTP_HOST
  let smtpPort = process.env.SMTP_PORT || '587'
  let smtpUser = process.env.SMTP_USER
  let smtpPassword = process.env.SMTP_PASSWORD

  if (tenantId) {
    try {
      const where: any = {
        tenantId,
        key: {
          in: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD'],
        },
      }

      if (storeId) {
        const storeSettings = await prisma.systemSettings.findMany({
          where: { ...where, storeId },
        })

        if (storeSettings.length > 0) {
          const settingsMap: Record<string, string> = {}
          storeSettings.forEach((setting: any) => {
            settingsMap[setting.key] = setting.value
          })
          smtpHost = settingsMap.SMTP_HOST || smtpHost
          smtpPort = settingsMap.SMTP_PORT || smtpPort
          smtpUser = settingsMap.SMTP_USER || smtpUser
          smtpPassword = settingsMap.SMTP_PASSWORD || smtpPassword
        }
      }

      if (!storeId || !smtpHost || !smtpUser || !smtpPassword) {
        const tenantSettings = await prisma.systemSettings.findMany({
          where: { ...where, storeId: null },
        })
        const settingsMap: Record<string, string> = {}
        tenantSettings.forEach((setting: any) => {
          settingsMap[setting.key] = setting.value
        })
        smtpHost = settingsMap.SMTP_HOST || smtpHost
        smtpPort = settingsMap.SMTP_PORT || smtpPort
        smtpUser = settingsMap.SMTP_USER || smtpUser
        smtpPassword = settingsMap.SMTP_PASSWORD || smtpPassword
      }
    } catch (error) {
      console.error('Error fetching SMTP config from SystemSettings:', error)
    }
  }

  return {
    host: smtpHost,
    port: parseInt(smtpPort || '587'),
    secure: parseInt(smtpPort || '587') === 465,
    auth: {
      user: smtpUser,
      pass: smtpPassword,
    },
  }
}

async function createTransporter(tenantId?: string, storeId?: string | null) {
  const config = await getSmtpConfig(tenantId, storeId)

  if (!config.host || !config.auth?.user || !config.auth?.pass) {
    console.warn(`[Email] SMTP configuration incomplete for tenant ${tenantId || 'default'}, store ${storeId || 'default'}.`)
    return null
  }

  const isGmail = config.host?.includes('gmail.com')
  const transporterConfig: any = { ...config }

  if (isGmail) {
    transporterConfig.service = 'gmail'
    delete transporterConfig.host
    delete transporterConfig.port
    transporterConfig.secure = false
    transporterConfig.requireTLS = true
  }

  return nodemailer.createTransport(transporterConfig)
}

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
    const smtpConfig = await getSmtpConfig(tenantId, storeId)
    const emailTransporter = await createTransporter(tenantId, storeId)

    if (!emailTransporter) {
      const errorMsg = `Email transporter not configured for tenant ${tenantId || 'default'}, store ${storeId || 'default'}.`
      console.error(`[Email] ${errorMsg}`)
      return { success: false, error: new Error(errorMsg) }
    }

    if (!smtpConfig.auth?.user || !smtpConfig.auth?.pass) {
      const errorMsg = 'SMTP credentials are missing.'
      console.error(`[Email] ${errorMsg}`)
      return { success: false, error: new Error(errorMsg) }
    }

    const emailMessageId = messageId || `<${Date.now()}-${Math.random().toString(36).substring(7)}@${smtpConfig.host || 'support'}>`

    const mailOptions: any = {
      from: smtpConfig.auth?.user || process.env.SMTP_USER,
      to,
      subject,
      messageId: emailMessageId,
    }

    if (text) {
      mailOptions.text = text
    } else if (html) {
      mailOptions.html = html
    }

    if (inReplyTo) {
      mailOptions.inReplyTo = inReplyTo
      mailOptions.references = references || inReplyTo
    }

    try {
      await emailTransporter.verify()
    } catch (verifyError: any) {
      console.error('[Email] SMTP connection verification failed:', verifyError)
      return { success: false, error: verifyError }
    }

    const result = await emailTransporter.sendMail(mailOptions)
    console.log(`[Email] Email sent successfully to ${to}`)
    return { success: true, messageId: result.messageId || emailMessageId }
  } catch (error: any) {
    console.error('[Email] Error sending email:', error)
    return { success: false, error }
  }
}
