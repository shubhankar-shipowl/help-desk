import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function createDefaultEmailTemplates() {
  try {
    console.log('Creating default email templates...')

    // Template 1: Ticket Created (TICKET_CREATED)
    // This is used when NotificationService tries to render TICKET_CREATED emails
    // Note: Ticket creation currently uses file-based template, but we'll create DB template for consistency
    await prisma.notificationTemplate.upsert({
      where: { type: 'TICKET_CREATED' },
      update: {},
      create: {
        type: 'TICKET_CREATED',
        channel: 'EMAIL',
        subject: 'Ticket Created Successfully - {{TICKET_NUMBER}}',
        bodyTemplate: 'Your ticket {{TICKET_NUMBER}} has been created successfully.',
        htmlTemplate: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #3B82F6; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
    <h1 style="margin: 0;">✓ Ticket Created Successfully</h1>
  </div>
  <div style="background: #ffffff; padding: 30px; border: 1px solid #e5e7eb; border-radius: 0 0 8px 8px;">
    <p style="font-size: 18px; font-weight: 600; margin-bottom: 20px;">Hi {{USER_NAME}},</p>
    <p>Thank you for reaching out to us! We've received your support request and our team is already on it. We'll get back to you as soon as possible.</p>
    
    <div style="background: #F3F4F6; border-left: 4px solid #3B82F6; padding: 20px; margin: 30px 0; border-radius: 8px;">
      <div style="font-size: 12px; color: #6B7280; text-transform: uppercase; font-weight: 600; margin-bottom: 5px;">Your Ticket ID</div>
      <div style="font-size: 24px; color: #3B82F6; font-weight: 600; margin-bottom: 20px;">#{{TICKET_NUMBER}}</div>
      <div style="margin: 20px 0;">
        <div style="padding: 12px 0; border-bottom: 1px solid #E5E7EB;">
          <span style="font-size: 13px; color: #6B7280; font-weight: 600; display: inline-block; width: 100px;">Subject:</span>
          <span style="font-size: 14px; color: #111827;">{{TICKET_SUBJECT}}</span>
        </div>
      </div>
    </div>
    
    <div style="text-align: center; margin: 30px 0;">
      <a href="{{TICKET_URL}}" style="display: inline-block; background: #3B82F6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600;">View Ticket Details →</a>
    </div>
  </div>
</body>
</html>
        `,
        isActive: true,
      },
    })

    // Template 2: Ticket Reply (TICKET_REPLY)
    // This is used when agents reply to tickets
    await prisma.notificationTemplate.upsert({
      where: { type: 'TICKET_REPLY' },
      update: {},
      create: {
        type: 'TICKET_REPLY',
        channel: 'EMAIL',
        subject: 'Re: Ticket Created Successfully - {{TICKET_NUMBER}}',
        bodyTemplate: '{{AGENT_NAME}} replied to your ticket {{TICKET_NUMBER}}: {{REPLY_CONTENT}}',
        htmlTemplate: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
  <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
    <h2 style="color: #2563eb; margin-top: 0;">{{TITLE}}</h2>
    <p style="margin: 10px 0;"><strong>Ticket:</strong> {{TICKET_NUMBER}}</p>
    <p style="margin: 10px 0;"><strong>Subject:</strong> {{TICKET_SUBJECT}}</p>
    <p style="margin: 10px 0;"><strong>From:</strong> {{AGENT_NAME}}</p>
  </div>
  
  <div style="background: #ffffff; border-left: 4px solid #2563eb; padding: 20px; margin: 20px 0;">
    <h3 style="margin-top: 0; color: #1e40af;">Reply:</h3>
    <div style="white-space: pre-wrap; color: #374151;">{{REPLY_CONTENT}}</div>
  </div>
  
  <div style="text-align: center; margin: 30px 0;">
    <a href="{{TICKET_URL}}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">View Full Ticket</a>
  </div>
  
  <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 14px;">
    <p>This is an automated notification. You can reply to this email or visit the ticket page to continue the conversation.</p>
  </div>
</body>
</html>
        `,
        isActive: true,
      },
    })

    console.log('✅ Default email templates created successfully!')
  } catch (error) {
    console.error('❌ Error creating default templates:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

createDefaultEmailTemplates()
  .then(() => {
    console.log('Done!')
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })

