import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatDate(date: Date | string | null | undefined): string {
  // Handle null/undefined
  if (!date) {
    return 'Unknown date'
  }

  // Parse date
  const d = typeof date === 'string' ? new Date(date) : date

  // Validate date
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    return 'Invalid date'
  }

  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d)
}

export function formatRelativeTime(date: Date | string | null | undefined): string {
  // Handle null/undefined
  if (!date) {
    return 'Unknown'
  }

  // Parse date
  const d = typeof date === 'string' ? new Date(date) : date

  // Validate date
  if (!(d instanceof Date) || isNaN(d.getTime())) {
    return 'Invalid date'
  }

  const now = new Date()
  const diffInSeconds = Math.floor((now.getTime() - d.getTime()) / 1000)

  // Handle negative differences (future dates)
  if (diffInSeconds < 0) {
    return 'just now'
  }

  if (diffInSeconds < 60) return 'just now'
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`
  return formatDate(d)
}

export function generateTicketNumber(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}${day}`
  
  // Generate a random 3-digit sequence number
  // In production, this should be a sequential number from database
  const sequence = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0')
  
  return `TKT-${dateStr}-${sequence}`
}

/**
 * Generate ticket number with database sequence (async)
 * Format: TKT-YYYY-MMDD-###
 */
export async function generateTicketNumberWithSequence(): Promise<string> {
  const { prisma } = await import('@/lib/prisma')
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const dateStr = `${year}-${month}${day}`
  
  // Get count of tickets created today with this prefix
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const endOfDay = new Date(startOfDay)
  endOfDay.setDate(endOfDay.getDate() + 1)
  
  const count = await prisma.ticket.count({
    where: {
      createdAt: {
        gte: startOfDay,
        lt: endOfDay,
      },
      ticketNumber: {
        startsWith: `TKT-${dateStr}-`,
      },
    },
  })
  
  const sequence = String(count + 1).padStart(3, '0')
  return `TKT-${dateStr}-${sequence}`
}

/**
 * Get the base URL for the application based on environment
 * - Development (NODE_ENV=development): http://localhost:3002
 * - Production (NODE_ENV=production): https://support.shipowl.io
 * 
 * This function is used throughout the app for:
 * - Email links
 * - Ticket URLs
 * - General application URLs
 */
export function getAppUrl(): string {
  const nodeEnv = process.env.NODE_ENV || 'development'
  
  if (nodeEnv === 'production') {
    // Production: use production domain
    return 'https://support.shipowl.io'
  }
  
  // Development: always use localhost
  return 'http://localhost:3002'
}

/**
 * Mask phone number to show only last 4 digits
 * Formats: XXX-XXX-1234, (XXX) XXX-1234, XXX XXX 1234, etc.
 */
export function maskPhoneNumber(phone: string | null | undefined): string {
  if (!phone) return ''
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '')
  if (digits.length <= 4) return phone // If too short, return as is
  
  // Show only last 4 digits
  const last4 = digits.slice(-4)
  
  // Format based on original phone format
  if (phone.includes('-')) {
    // Format: XXX-XXX-1234 or XXX-1234 for shorter numbers
    if (digits.length === 7) {
      return `XXX-${last4}`
    } else if (digits.length === 10) {
      return `XXX-XXX-${last4}`
    } else {
      return `XXX-${last4}`
    }
  } else if (phone.includes(' ')) {
    // Format: XXX XXX 1234 or XXX 1234
    if (digits.length === 7) {
      return `XXX ${last4}`
    } else if (digits.length === 10) {
      return `XXX XXX ${last4}`
    } else {
      return `XXX ${last4}`
    }
  } else if (phone.includes('(')) {
    // Format: (XXX) XXX-1234
    return `(XXX) XXX-${last4}`
  } else {
    // Simple format: always use XXX-XXXX format for better readability
    if (digits.length === 7) {
      return `XXX-${last4}`
    } else if (digits.length === 10) {
      return `XXX-XXX-${last4}`
    } else {
      // For other lengths, use XXX-XXXX format
      return `XXX-${last4}`
    }
  }
}

/**
 * Mask email address to show only first 2 characters and last part of domain
 * Format: sh****@gmail.com or sh****@ex***.com
 */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return ''
  
  // Check if it's a valid email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return email // Return as is if not a valid email
  }
  
  const [localPart, domain] = email.split('@')
  
  if (!localPart || !domain) return email
  
  // Mask local part: show first 2 characters, then mask the rest
  let maskedLocal = ''
  if (localPart.length <= 2) {
    maskedLocal = localPart.charAt(0) + '*'
  } else {
    maskedLocal = localPart.substring(0, 2) + '*'.repeat(Math.min(localPart.length - 2, 4))
  }
  
  // Mask domain: show first 2 characters of domain name, then mask
  const [domainName, ...tldParts] = domain.split('.')
  const tld = tldParts.join('.')
  
  let maskedDomain = ''
  if (domainName.length <= 2) {
    maskedDomain = domainName.charAt(0) + '*' + '.' + tld
  } else {
    maskedDomain = domainName.substring(0, 2) + '*'.repeat(Math.min(domainName.length - 2, 3)) + '.' + tld
  }
  
  return `${maskedLocal}@${maskedDomain}`
}

