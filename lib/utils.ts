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

/**
 * Mask phone numbers in text content (descriptions, messages, etc.)
 * Finds phone numbers in various formats and masks them
 * Formats: 9553207206, 955-320-7206, (955) 320-7206, +91 9553207206, etc.
 */
export function maskPhoneNumbersInText(text: string | null | undefined): string {
  if (!text) return ''
  
  // Regex patterns for various phone number formats
  // Matches: 10-digit numbers, numbers with dashes/spaces/parentheses, numbers with country codes
  const phonePatterns = [
    // 10-digit numbers: 9553207206
    /\b(\d{10})\b/g,
    // With dashes: 955-320-7206, 955-3207-206
    /\b(\d{3})-(\d{3,4})-(\d{3,4})\b/g,
    // With spaces: 955 320 7206, 955 3207 206
    /\b(\d{3})\s+(\d{3,4})\s+(\d{3,4})\b/g,
    // With parentheses: (955) 320-7206, (955) 320 7206
    /\((\d{3})\)\s*(\d{3,4})[- ]?(\d{3,4})\b/g,
    // With country code: +91 9553207206, +1 9553207206
    /\+\d{1,3}[\s-]?(\d{10})\b/g,
    // Contact number: Contact number :9553207206, Contact: 9553207206
    /[Cc]ontact\s+[Nn]umber\s*:?\s*(\d{10})\b/gi,
    // Phone/Phone number: Phone: 9553207206, Phone number: 9553207206
    /[Pp]hone\s*([Nn]umber)?\s*:?\s*(\d{10})\b/gi,
  ]
  
  let maskedText = text
  
  phonePatterns.forEach((pattern) => {
    maskedText = maskedText.replace(pattern, (match, ...groups) => {
      // Extract all digits from the match
      const allDigits = match.replace(/\D/g, '')
      
      // If it's a 10-digit number or longer, mask it
      if (allDigits.length >= 10) {
        const last4 = allDigits.slice(-4)
        // Preserve the format structure if possible
        if (match.includes('-')) {
          if (allDigits.length === 10) {
            return `XXX-XXX-${last4}`
          } else {
            return `XXX-${last4}`
          }
        } else if (match.includes(' ')) {
          if (allDigits.length === 10) {
            return `XXX XXX ${last4}`
          } else {
            return `XXX ${last4}`
          }
        } else if (match.includes('(')) {
          return `(XXX) XXX-${last4}`
        } else if (match.startsWith('+')) {
          // Preserve country code format
          const countryCode = match.match(/^\+(\d{1,3})/)?.[1] || ''
          return `+${countryCode} XXX-XXX-${last4}`
        } else {
          // Simple 10-digit format
          if (allDigits.length === 10) {
            return `XXX-XXX-${last4}`
          } else {
            return `XXX-${last4}`
          }
        }
      }
      
      return match // Return original if doesn't match criteria
    })
  })
  
  return maskedText
}
