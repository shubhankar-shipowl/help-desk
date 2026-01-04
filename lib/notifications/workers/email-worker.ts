import { prisma } from '../../prisma'
import { sendEmail } from '../../email'
import { emailQueue } from '../queues'

console.log('[Email Worker] 🚀 Starting email worker...')

// Process email jobs
emailQueue.process(
  'send-email',
  5, // Concurrency: process 5 emails at a time
  async (job) => {
    const { notificationId, to, subject, html, text, type, userId, tenantId, inReplyTo, references } = job.data

    console.log(`[Email Worker] 📧 Processing email job:`, {
      jobId: job.id,
      notificationId,
      to,
      subject: subject.substring(0, 50),
      type,
      format: text ? 'plain text' : 'html',
      tenantId: tenantId || 'default',
    })

    try {
      // Get tenantId from notification if not provided in job data
      let finalTenantId = tenantId
      if (!finalTenantId && notificationId) {
        try {
          const notification = await prisma.notification.findUnique({
            where: { id: notificationId },
            select: { tenantId: true },
          })
          finalTenantId = notification?.tenantId || undefined
        } catch (error) {
          console.warn(`[Email Worker] Could not fetch tenantId from notification ${notificationId}:`, error)
        }
      }

      // Send email with threading support
      const result = await sendEmail({
        to,
        subject,
        html,
        text,
        inReplyTo,
        references,
        tenantId: finalTenantId,
      })

      // Update delivery log
      await prisma.notificationDeliveryLog.updateMany({
        where: {
          notificationId,
          channel: 'EMAIL',
        },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          messageId: (result as any).messageId || undefined,
        },
      })

      console.log(`[Email Worker] ✅ Email sent successfully:`, {
        notificationId,
        to,
        messageId: (result as any).messageId,
      })
      return { success: true, messageId: (result as any).messageId }
    } catch (error: any) {
      console.error(`[Email Worker] ❌ Email send failed:`, {
        notificationId,
        to,
        error: error.message,
        stack: error.stack,
      })

      // Update delivery log
      await prisma.notificationDeliveryLog.updateMany({
        where: {
          notificationId,
          channel: 'EMAIL',
        },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          errorMessage: error.message || 'Unknown error',
          attempts: { increment: 1 },
        },
      })

      throw error // Will trigger retry
    }
  }
)

emailQueue.on('completed', (job) => {
  console.log(`[Email Worker] ✅ Job completed: ${job.id}`)
})

emailQueue.on('failed', (job, err) => {
  console.error(`[Email Worker] ❌ Job failed:`, {
    jobId: job?.id,
    error: err.message,
  })
})

emailQueue.on('error', (error) => {
  console.error(`[Email Worker] ❌ Queue error:`, error)
})

emailQueue.on('waiting', (jobId) => {
  console.log(`[Email Worker] ⏳ Job waiting: ${jobId}`)
})

emailQueue.on('active', (job) => {
  console.log(`[Email Worker] 🔄 Job active: ${job.id}`)
})

console.log('[Email Worker] ✅ Email worker initialized and ready to process jobs')

// Export the queue for external access
export { emailQueue as emailWorker }

