import { prisma } from '../config/database'

/**
 * Email Threading Utility
 * Implements Gmail-style email threading using In-Reply-To, References headers,
 * and normalized subject matching.
 */

export interface EmailData {
  messageId: string
  inReplyTo?: string | null
  references?: string | string[] | null
  subject: string
  fromEmail: string
  toEmail: string
  headers?: Record<string, any> | null
}

/**
 * Normalize email subject by removing reply/forward prefixes
 */
export function normalizeSubject(subject: string): string {
  if (!subject) return ''

  let normalized = subject.trim()

  const prefixes = [
    /^re\s*:\s*/i,
    /^fwd\s*:\s*/i,
    /^fw\s*:\s*/i,
    /^\[external\]\s*/i,
    /^\[spam\]\s*/i,
  ]

  let changed = true
  while (changed) {
    changed = false
    for (const prefix of prefixes) {
      if (prefix.test(normalized)) {
        normalized = normalized.replace(prefix, '').trim()
        changed = true
      }
    }
  }

  normalized = normalized.replace(/\[[^\]]*\]/g, '').trim()

  return normalized.toLowerCase()
}

/**
 * Normalize Message-ID by removing angle brackets
 */
export function normalizeMessageId(messageId: string | null | undefined): string {
  if (!messageId) return ''
  return messageId.replace(/^<|>$/g, '').trim()
}

/**
 * Extract In-Reply-To and References from email headers
 */
export function extractThreadHeaders(headers: Record<string, any> | null | undefined): {
  inReplyTo: string | null
  references: string[]
} {
  if (!headers) {
    return { inReplyTo: null, references: [] }
  }

  let inReplyTo: string | null = null
  const references: string[] = []

  for (const key of ['in-reply-to', 'in_reply_to', 'inreplyto']) {
    const headerKey = Object.keys(headers).find(k => k.toLowerCase() === key)
    if (headerKey) {
      const value = headers[headerKey]
      if (value) {
        inReplyTo = normalizeMessageId(String(value))
        break
      }
    }
  }

  for (const key of ['references', 'reference']) {
    const headerKey = Object.keys(headers).find(k => k.toLowerCase() === key)
    if (headerKey) {
      const value = headers[headerKey]
      if (value) {
        const refs = String(value).split(/\s+/).filter(Boolean)
        refs.forEach(ref => {
          const normalized = normalizeMessageId(ref)
          if (normalized && !references.includes(normalized)) {
            references.push(normalized)
          }
        })
        break
      }
    }
  }

  return { inReplyTo, references }
}

/**
 * Find or create thread ID for an incoming email
 */
export async function findOrCreateThreadId(
  emailData: EmailData,
  tenantId: string,
  storeId: string | null = null
): Promise<string> {
  const { messageId, inReplyTo, references, subject, fromEmail, toEmail, headers } = emailData

  let extractedInReplyTo = inReplyTo
  let extractedReferences: string[] = []

  if (headers) {
    const extracted = extractThreadHeaders(headers)
    extractedInReplyTo = extractedInReplyTo || extracted.inReplyTo
    extractedReferences = extracted.references.length > 0 ? extracted.references : (references ? (Array.isArray(references) ? references : [references]) : [])
  } else if (references) {
    extractedReferences = Array.isArray(references) ? references : [references]
  }

  const normalizedMessageId = normalizeMessageId(messageId)
  const normalizedInReplyTo = extractedInReplyTo ? normalizeMessageId(extractedInReplyTo) : null
  const normalizedReferences = extractedReferences.map(ref => normalizeMessageId(ref)).filter(Boolean)

  // Step 1: Check if replying to existing message (In-Reply-To)
  if (normalizedInReplyTo) {
    const parentEmail = await prisma.email.findFirst({
      where: {
        tenantId,
        ...(storeId ? { storeId } : {}),
        OR: [
          { messageId: normalizedInReplyTo },
          { messageId: `<${normalizedInReplyTo}>` },
          { messageId: { contains: normalizedInReplyTo } },
        ],
      },
      select: { threadId: true, id: true },
    })

    if (parentEmail?.threadId) {
      return parentEmail.threadId
    }

    if (parentEmail) {
      return normalizedInReplyTo
    }
  }

  // Step 2: Check References header
  for (const refMsgId of normalizedReferences) {
    const refEmail = await prisma.email.findFirst({
      where: {
        tenantId,
        ...(storeId ? { storeId } : {}),
        OR: [
          { messageId: refMsgId },
          { messageId: `<${refMsgId}>` },
          { messageId: { contains: refMsgId } },
        ],
      },
      select: { threadId: true, id: true },
    })

    if (refEmail?.threadId) {
      return refEmail.threadId
    }

    if (refEmail) {
      return refMsgId
    }
  }

  // Step 3: Match by normalized subject and participants (within last 7 days)
  const normalizedSubjectStr = normalizeSubject(subject)
  if (normalizedSubjectStr) {
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

    const participants = [fromEmail.toLowerCase(), toEmail.toLowerCase()].sort()

    const recentEmails = await prisma.email.findMany({
      where: {
        tenantId,
        ...(storeId ? { storeId } : {}),
        createdAt: { gte: sevenDaysAgo },
      },
      select: {
        id: true,
        threadId: true,
        subject: true,
        fromEmail: true,
        toEmail: true,
        messageId: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })

    for (const recentEmail of recentEmails) {
      const recentNormalizedSubject = normalizeSubject(recentEmail.subject)
      if (recentNormalizedSubject === normalizedSubjectStr) {
        const recentParticipants = [
          recentEmail.fromEmail.toLowerCase(),
          recentEmail.toEmail.toLowerCase(),
        ].sort()

        const hasCommonParticipants =
          participants.some(p => recentParticipants.includes(p)) ||
          recentParticipants.some(p => participants.includes(p))

        if (hasCommonParticipants) {
          if (recentEmail.threadId) {
            return recentEmail.threadId
          }
          return normalizeMessageId(recentEmail.messageId)
        }
      }
    }
  }

  // Step 4: Create new thread (use messageId as threadId)
  return normalizedMessageId
}

/**
 * Update threadId for an email and propagate to related emails
 */
export async function updateEmailThreadId(
  emailId: string,
  threadId: string,
  tenantId: string,
  storeId: string | null = null
): Promise<void> {
  await prisma.email.update({
    where: { id: emailId },
    data: { threadId },
  })

  const email = await prisma.email.findUnique({
    where: { id: emailId },
    select: { messageId: true, headers: true },
  })

  if (!email) return

  const { inReplyTo, references } = extractThreadHeaders(email.headers as Record<string, any>)
  const normalizedMsgId = normalizeMessageId(email.messageId)
  const normalizedInReplyTo = inReplyTo ? normalizeMessageId(inReplyTo) : null

  const updatePromises: Promise<any>[] = []

  if (normalizedMsgId) {
    const relatedEmails = await prisma.email.findMany({
      where: {
        tenantId,
        ...(storeId ? { storeId } : {}),
        id: { not: emailId },
        OR: [
          {
            headers: {
              path: 'in-reply-to',
              string_contains: normalizedMsgId,
            },
          },
          {
            headers: {
              path: 'references',
              string_contains: normalizedMsgId,
            },
          },
        ],
      },
      select: { id: true },
    })

    relatedEmails.forEach(relatedEmail => {
      updatePromises.push(
        prisma.email.update({
          where: { id: relatedEmail.id },
          data: { threadId },
        })
      )
    })
  }

  if (normalizedInReplyTo) {
    const parentEmail = await prisma.email.findFirst({
      where: {
        tenantId,
        ...(storeId ? { storeId } : {}),
        OR: [
          { messageId: normalizedInReplyTo },
          { messageId: `<${normalizedInReplyTo}>` },
        ],
      },
      select: { id: true, threadId: true },
    })

    if (parentEmail && !parentEmail.threadId) {
      updatePromises.push(
        prisma.email.update({
          where: { id: parentEmail.id },
          data: { threadId },
        })
      )
    }
  }

  await Promise.all(updatePromises)
}
