import { prisma } from '../../prisma'
import { sendEmail } from '../../email'
import { emailQueue } from '../queues'

console.log('[Email Worker] 🚀 Starting email worker...')

// Process email jobs
emailQueue.process(
  'send-email',
  5, // Concurrency: process 5 emails at a time
  async (job) => {
    const { notificationId, to, subject, html, text, type, userId, tenantId, storeId, inReplyTo, references } = job.data

    console.log(`[Email Worker] 📧 Processing email job:`, {
      jobId: job.id,
      notificationId,
      to,
      subject: subject.substring(0, 50),
      type,
      format: text ? 'plain text' : 'html',
      tenantId: tenantId || 'default',
      storeId: storeId || 'default',
    })

    try {
      // Get tenantId and storeId from user or notification if not provided
      let finalTenantId = tenantId
      let finalStoreId = storeId
      
      if ((!finalTenantId || !finalStoreId) && userId) {
        try {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { tenantId: true, storeId: true },
          })
          finalTenantId = finalTenantId || user?.tenantId || undefined
          finalStoreId = finalStoreId || user?.storeId || undefined
        } catch (error) {
          console.warn(`[Email Worker] Could not fetch tenant/store from user ${userId}:`, error)
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
        storeId: finalStoreId,
      })

      // Check if email was actually sent successfully
      if (!result.success) {
        throw new Error(result.error?.message || 'Email sending failed')
      }

      // Update delivery log
      await prisma.notificationDeliveryLog.updateMany({
        where: {
          notificationId,
          channel: 'EMAIL',
        },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          messageId: result.messageId || undefined,
        },
      })

      console.log(`[Email Worker] ✅ Email sent successfully:`, {
        notificationId,
        to,
        messageId: result.messageId,
      })
      return { success: true, messageId: result.messageId }
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

