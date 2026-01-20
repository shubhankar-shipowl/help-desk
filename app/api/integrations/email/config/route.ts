import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import nodemailer from 'nodemailer'

/**
 * Get Email/SMTP configuration from SystemSettings
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Get storeId from query parameter (optional)
    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId') || null

    // Fetch all SMTP and IMAP-related settings (store-specific first, then tenant-level)
    const settings = await prisma.systemSettings.findMany({
      where: {
        tenantId,
        storeId: storeId || null,
        key: {
          in: ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'IMAP_EMAIL', 'IMAP_APP_PASSWORD'],
        },
      },
    })

    // Convert array to object
    const config: Record<string, string> = {}
    settings.forEach((setting) => {
      config[setting.key] = setting.value
    })

    return NextResponse.json({
      config: {
        smtpHost: config.SMTP_HOST || '',
        smtpPort: config.SMTP_PORT || '587',
        smtpUser: config.SMTP_USER || '',
        smtpPassword: config.SMTP_PASSWORD || '',
        imapEmail: config.IMAP_EMAIL || '',
        imapAppPassword: config.IMAP_APP_PASSWORD || '',
      },
    })
  } catch (error: any) {
    console.error('Error fetching email config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch configuration' },
      { status: 500 }
    )
  }
}

/**
 * Save Email/SMTP configuration to SystemSettings
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const body = await req.json()
    let { smtpHost, smtpPort, smtpUser, smtpPassword, imapEmail, imapAppPassword, storeId } = body

    // Trim all fields to remove leading/trailing whitespace
    smtpHost = smtpHost?.trim()
    smtpPort = smtpPort?.trim()
    smtpUser = smtpUser?.trim()
    smtpPassword = smtpPassword?.trim() // Important: trim password to avoid whitespace issues
    imapEmail = imapEmail?.trim()
    imapAppPassword = imapAppPassword?.trim()

    // Validate storeId if provided - ensure it exists in the database
    if (storeId) {
      const storeExists = await prisma.store.findFirst({
        where: {
          id: storeId,
          tenantId,
        },
      })
      if (!storeExists) {
        // Store doesn't exist, save at tenant level instead
        console.log(`[Email Config] Store ${storeId} not found, saving at tenant level`)
        storeId = null
      }
    }

    // Validate required SMTP fields
    if (!smtpHost || !smtpPort || !smtpUser || !smtpPassword) {
      return NextResponse.json(
        { error: 'All SMTP fields are required' },
        { status: 400 }
      )
    }

    // IMAP fields are optional but if one is provided, both should be provided
    if ((imapEmail && !imapAppPassword) || (!imapEmail && imapAppPassword)) {
      return NextResponse.json(
        { error: 'Both IMAP Email and IMAP App Password are required if IMAP is configured' },
        { status: 400 }
      )
    }

    // Validate port
    const port = parseInt(smtpPort)
    if (isNaN(port) || port < 1 || port > 65535) {
      return NextResponse.json(
        { error: 'SMTP Port must be a valid number between 1 and 65535' },
        { status: 400 }
      )
    }

    // Test SMTP connection before saving
    try {
      const isGmail = smtpHost.toLowerCase().includes('gmail.com') || smtpUser.toLowerCase().includes('@gmail.com')
      
      // Build transporter config
      const transporterConfig: any = {
        auth: {
          user: smtpUser,
          pass: smtpPassword, // Use trimmed password
        },
      }

      if (isGmail) {
        // Gmail-specific configuration
        transporterConfig.service = 'gmail'
        transporterConfig.secure = false
        transporterConfig.requireTLS = true
      } else {
        // Generic SMTP configuration
        transporterConfig.host = smtpHost
        transporterConfig.port = port
        transporterConfig.secure = port === 465
        if (port === 587) {
          transporterConfig.requireTLS = true
        }
      }

      const testTransporter = nodemailer.createTransport(transporterConfig)
      
      // Verify connection with timeout
      await Promise.race([
        testTransporter.verify(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('SMTP connection timeout')), 10000)
        )
      ])
    } catch (testError: any) {
      console.error('SMTP connection test failed:', testError)
      
      let errorMessage = 'SMTP connection test failed. Please check your credentials.'
      
      if (testError.code === 'EAUTH' || testError.responseCode === 535) {
        const isGmail = smtpHost.toLowerCase().includes('gmail.com') || smtpUser.toLowerCase().includes('@gmail.com')
        
        if (isGmail) {
          errorMessage = 'Gmail authentication failed. Please ensure:\n' +
            '1. You are using an App Password (NOT your regular Gmail password)\n' +
            '2. 2-Step Verification is enabled on your Google account\n' +
            '3. You have generated an App Password at: https://myaccount.google.com/apppasswords\n' +
            '4. Copy the 16-character App Password exactly (no spaces)\n' +
            '5. The App Password is for "Mail" application'
        } else {
          errorMessage = 'SMTP authentication failed. Please check:\n' +
            '1. Your username/email is correct\n' +
            '2. Your password is correct\n' +
            '3. There are no extra spaces in the password field'
        }
      } else if (testError.code === 'ECONNECTION' || testError.code === 'ETIMEDOUT' || testError.message?.includes('timeout')) {
        errorMessage = `Cannot connect to SMTP server ${smtpHost}:${port}. Please check:\n` +
          `1. The host and port are correct\n` +
          `2. Your firewall allows connections to this server\n` +
          `3. The server is accessible from your network`
      } else if (testError.message) {
        errorMessage = testError.message
      }
      
      return NextResponse.json(
        { error: errorMessage },
        { status: 400 }
      )
    }

    // Save or update each setting (store-specific if storeId provided)
    // Use trimmed values to ensure no whitespace issues
    const settingsToSave = [
      { key: 'SMTP_HOST', value: smtpHost.trim() },
      { key: 'SMTP_PORT', value: smtpPort.trim() },
      { key: 'SMTP_USER', value: smtpUser.trim() },
      { key: 'SMTP_PASSWORD', value: smtpPassword.trim() }, // Save trimmed password
    ]

    // Add IMAP settings if provided
    if (imapEmail && imapAppPassword) {
      settingsToSave.push(
        { key: 'IMAP_EMAIL', value: imapEmail.trim() },
        { key: 'IMAP_APP_PASSWORD', value: imapAppPassword.trim() }
      )
    }

    for (const setting of settingsToSave) {
      // Find existing setting
      const existing = await prisma.systemSettings.findFirst({
        where: {
          tenantId,
          storeId: storeId || null,
          key: setting.key,
        },
      })

      if (existing) {
        await prisma.systemSettings.update({
          where: { id: existing.id },
          data: { value: setting.value },
        })
      } else {
        await prisma.systemSettings.create({
          data: {
            tenantId,
            storeId: storeId || null,
            key: setting.key,
            value: setting.value,
          },
        })
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Email configuration saved successfully',
    })
  } catch (error: any) {
    console.error('Error saving email config:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save configuration' },
      { status: 500 }
    )
  }
}

