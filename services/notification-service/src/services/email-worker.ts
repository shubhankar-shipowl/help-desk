import { prisma } from '../config/database'
import { sendEmail } from './email-sender'
import { emailQueue } from './queues'

console.log('[Email Worker] Starting email worker...')

emailQueue.process(
  'send-email',
  5,
  async (job) => {
    const { notificationId, to, subject, html, text, type, userId, tenantId, storeId, inReplyTo, references } = job.data

    console.log(`[Email Worker] Processing email job:`, {
      jobId: job.id,
      notificationId,
      to,
      subject: subject.substring(0, 50),
      type,
    })

    try {
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

      if (!result.success) {
        throw new Error(result.error?.message || 'Email sending failed')
      }

      await prisma.notificationDeliveryLog.updateMany({
        where: { notificationId, channel: 'EMAIL' },
        data: {
          status: 'SENT',
          sentAt: new Date(),
          messageId: result.messageId || undefined,
        },
      })

      console.log(`[Email Worker] Email sent successfully:`, {
        notificationId,
        to,
        messageId: result.messageId,
      })
      return { success: true, messageId: result.messageId }
    } catch (error: any) {
      console.error(`[Email Worker] Email send failed:`, {
        notificationId,
        to,
        error: error.message,
      })

      await prisma.notificationDeliveryLog.updateMany({
        where: { notificationId, channel: 'EMAIL' },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          errorMessage: error.message || 'Unknown error',
          attempts: { increment: 1 },
        },
      })

      throw error
    }
  }
)

emailQueue.on('completed', (job) => {
  console.log(`[Email Worker] Job completed: ${job.id}`)
})

emailQueue.on('failed', (job, err) => {
  console.error(`[Email Worker] Job failed:`, {
    jobId: job?.id,
    error: err.message,
  })
})

console.log('[Email Worker] Email worker initialized and ready to process jobs')

export { emailQueue as emailWorker }
