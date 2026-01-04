/**
 * Text formatter and filter utility
 * Formats text and filters inappropriate content
 * Rewrites text in a polite, professional customer support tone
 */

// Spellchecker library (server-side only)
// This is a Node.js native module, so it cannot be used in the browser
// We'll use a lazy-load approach to prevent webpack from bundling it
let SpellChecker: any = null

// Function to get spellchecker (only loads on server, never in browser)
function getSpellChecker() {
  // Only try to load on server side
  if (typeof window !== 'undefined') {
    return null // Browser - don't load
  }
  
  if (SpellChecker === null) {
    try {
      // Use dynamic require to prevent webpack from bundling
      SpellChecker = eval('require')('spellchecker')
    } catch (e) {
      // spellchecker not available - use dictionary-based approach
      SpellChecker = false // Mark as unavailable
    }
  }
  
  return SpellChecker || null
}

// Common inappropriate/abusive words list (will be neutralized)
const INAPPROPRIATE_WORDS = [
  'damn', 'hell', 'stupid', 'idiot', 'fool', 'crazy', 'insane',
  'hate', 'terrible', 'awful', 'horrible', 'worst', 'useless',
  // Add more as needed
]

// Word replacements for neutralization (inappropriate -> neutral)
const NEUTRAL_REPLACEMENTS: Record<string, string> = {
  'damn': 'unfortunate',
  'hell': 'difficult situation',
  'stupid': 'unexpected',
  'idiot': 'issue',
  'fool': 'problem',
  'crazy': 'unusual',
  'insane': 'unexpected',
  'hate': 'disappointed with',
  'terrible': 'concerning',
  'awful': 'concerning',
  'horrible': 'concerning',
  'worst': 'not as expected',
  'useless': 'not working as expected',
}

// Common spelling corrections - expanded list
const SPELLING_CORRECTIONS: Record<string, string> = {
  // Received variations
  'recevid': 'received',
  'recieved': 'received',
  'recived': 'received',
  'recievd': 'received',
  'recevd': 'received',
  // Wrong variations
  'wrog': 'wrong',
  'wron': 'wrong',
  'wrogb': 'wrong',
  'wronb': 'wrong',
  // Product variations
  'prodcut': 'product',
  'produt': 'product',
  'produc': 'product',
  // Issue variations
  'issu': 'issue',
  'isue': 'issue',
  'issuse': 'issue',
  // Delivery variations
  'delivry': 'delivery',
  'deliverey': 'delivery',
  'deliverd': 'delivered',
  'deleverd': 'delivered', // Added: deleverd -> delivered
  'delevred': 'delivered',
  'delivrd': 'delivered',
  // Order variations
  'ordr': 'order',
  'oder': 'order',
  'ordir': 'order', // Added: ordir -> order
  // Replacement variations
  'replacment': 'replacement',
  'replacmen': 'replacement',
  // Return variations
  'retun': 'return',
  'retunr': 'return',
  // Damage variations
  'damge': 'damage',
  'damagd': 'damaged',
  // Broken variations
  'brokn': 'broken',
  'brokne': 'broken',
  // Missing variations
  'missng': 'missing',
  'missin': 'missing',
  // Defective variations
  'defctiv': 'defective',
  'defctve': 'defective',
  // Common words
  'not': 'not',
  'the': 'the',
  'is': 'is',
  'was': 'was',
  'are': 'are',
  'were': 'were',
  'have': 'have',
  'has': 'has',
  'had': 'had',
  'will': 'will',
  'would': 'would',
  'should': 'should',
  'could': 'could',
  'can': 'can',
  'may': 'may',
  'might': 'might',
}

/**
 * Format and filter text - Professional customer support style
 * - Cleans and formats text
 * - Removes/neutralizes inappropriate language
 * - Rewrites in polite, professional tone
 * - Keeps original meaning intact
 * - Fixes spelling and grammar
 */
export function formatAndFilterText(text: string): string {
  if (!text || text.trim().length === 0) {
    return text
  }

  let formatted = text

  // Step 1: Remove extra whitespace and normalize
  formatted = formatted.replace(/\s+/g, ' ').trim()

  // Step 2: Fix spacing around punctuation
  formatted = formatted.replace(/\s+([,.!?;:])/g, '$1') // Remove space before punctuation
  formatted = formatted.replace(/([,.!?;:])([^\s])/g, '$1 $2') // Add space after punctuation if missing

  // Step 3: Fix spelling mistakes using spellchecker library + dictionary
  // First, apply dictionary-based corrections (fast and accurate for known misspellings)
  Object.entries(SPELLING_CORRECTIONS).forEach(([wrong, correct]) => {
    const regex = new RegExp(`\\b${wrong}\\b`, 'gi')
    formatted = formatted.replace(regex, (match) => {
      if (match === match.toUpperCase()) {
        return correct.toUpperCase()
      } else if (match === match.charAt(0).toUpperCase() + match.slice(1).toLowerCase()) {
        return correct.charAt(0).toUpperCase() + correct.slice(1)
      }
      return correct
    })
  })
  
  // Then, use spellchecker library for additional corrections (server-side only)
  // Note: spellchecker is a Node.js native module, so it only works on the server
  // On the client side, we'll use dictionary-based corrections only
  const spellChecker = getSpellChecker()
  if (spellChecker) {
    try {
      const wordPattern = /\b([a-zA-Z]+)\b/g
      formatted = formatted.replace(wordPattern, (match, word) => {
        // Skip if already in our dictionary (already corrected)
        const lowerWord = word.toLowerCase()
        if (SPELLING_CORRECTIONS[lowerWord]) {
          return match // Already handled by dictionary
        }
        
        // Check if word is misspelled using spellchecker
        const isMisspelled = spellChecker.isMisspelled(word)
        
        if (isMisspelled) {
          // Get suggestions from spellchecker
          const suggestions = spellChecker.getCorrectionsForMisspelling(word)
          
          if (suggestions && suggestions.length > 0) {
            // Use the first (most likely) suggestion
            const correct = suggestions[0]
            
            // Preserve original case
            if (word === word.toUpperCase()) {
              return correct.toUpperCase()
            } else if (word.charAt(0) === word.charAt(0).toUpperCase()) {
              return correct.charAt(0).toUpperCase() + correct.slice(1)
            }
            return correct
          }
        }
        
        return match
      })
    } catch (e) {
      // If spellchecker fails, fall back to dictionary
      // This can happen if the module isn't available
    }
  }
  
  // Additional dictionary-based word-by-word correction (works everywhere)
  const wordPattern = /\b([a-zA-Z]+)\b/g
  formatted = formatted.replace(wordPattern, (match, word) => {
    const lowerWord = word.toLowerCase()
    
    // Check spelling corrections dictionary
    if (SPELLING_CORRECTIONS[lowerWord]) {
      const correct = SPELLING_CORRECTIONS[lowerWord]
      // Preserve original case
      if (word === word.toUpperCase()) {
        return correct.toUpperCase()
      } else if (word.charAt(0) === word.charAt(0).toUpperCase()) {
        return correct.charAt(0).toUpperCase() + correct.slice(1)
      }
      return correct
    }
    
    return match
  })

  // Step 4: Neutralize inappropriate/abusive language (replace with neutral alternatives)
  Object.entries(NEUTRAL_REPLACEMENTS).forEach(([inappropriate, neutral]) => {
    const regex = new RegExp(`\\b${inappropriate}\\b`, 'gi')
    formatted = formatted.replace(regex, neutral)
  })

  // Step 5: Fix common grammar issues
  formatted = formatted.replace(/\bi\b/g, 'I') // Capitalize standalone 'i'
  formatted = formatted.replace(/\bim\b/gi, "I'm")
  formatted = formatted.replace(/\bive\b/gi, "I've")
  formatted = formatted.replace(/\bid\b/gi, "I'd")
  formatted = formatted.replace(/\bill\b/gi, "I'll")

  // Step 6: Rewrite in professional tone
  // Make sentences more polite and professional
  formatted = makeProfessional(formatted)

  // Step 7: Capitalize first letter of each sentence
  if (formatted.length > 0) {
    // Capitalize first letter
    formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1)
    
    // Capitalize after sentence endings (. ! ?)
    formatted = formatted.replace(/([.!?]\s+)([a-z])/g, (match, p1, p2) => {
      return p1 + p2.toUpperCase()
    })
  }

  // Step 8: Fix double spaces that might have been created
  formatted = formatted.replace(/\s+/g, ' ').trim()

  return formatted
}

/**
 * Rewrite text in a professional, polite tone
 * Keeps original meaning but makes it more respectful
 */
function makeProfessional(text: string): string {
  let professional = text

  // Remove excessive exclamation marks (keep only one)
  professional = professional.replace(/!{2,}/g, '!')
  
  // Remove excessive question marks
  professional = professional.replace(/\?{2,}/g, '?')

  // Replace aggressive phrases with polite alternatives
  const politeReplacements: Array<[RegExp, string]> = [
    [/why (didn't|did not|doesn't|does not|won't|will not)/gi, 'I would like to understand why'],
    [/you (need|must|have to|should)/gi, 'it would be helpful if'],
    [/fix (it|this|that)/gi, 'resolve this issue'],
    [/broken/gi, 'not working as expected'],
    [/doesn't work/gi, 'is not functioning properly'],
    [/won't work/gi, 'is not functioning properly'],
    [/not working/gi, 'not functioning as expected'],
    [/very bad/gi, 'concerning'],
    [/really bad/gi, 'concerning'],
    [/so bad/gi, 'concerning'],
  ]

  politeReplacements.forEach(([pattern, replacement]) => {
    professional = professional.replace(pattern, replacement)
  })

  // Ensure sentences end properly
  if (!professional.match(/[.!?]$/)) {
    professional = professional + '.'
  }

  return professional
}

/**
 * Format text as professional customer support email
 * Follows the customer support assistant format:
 * - Cleans and formats text
 * - Removes/neutralizes inappropriate language
 * - Rewrites in polite, professional tone
 * - Formats as professional email
 */
export function formatAsProfessionalEmail(
  description: string,
  customerName?: string,
  ticketNumber?: string
): string {
  // First, clean and format the description (this handles spelling, grammar, neutralization)
  const cleanedText = formatAndFilterText(description)
  
  // Get customer name or use default
  const name = customerName?.trim() || 'Customer'
  
  // Build professional email format
  let emailBody = `Dear Support Team,\n\n${cleanedText}\n\nThank you for your assistance.\n\nKind regards,\n${name}`
  
  // If ticket number is provided, add subject line
  if (ticketNumber) {
    return `Subject: Support Request – Ticket ${ticketNumber}\n\n${emailBody}`
  }
  
  return emailBody
}

/**
 * Check if text contains inappropriate content
 */
export function hasInappropriateContent(text: string): boolean {
  if (!text) return false
  
  const words = text.toLowerCase().split(/\s+/)
  return words.some(word => {
    const cleanWord = word.replace(/[.,!?;:]/g, '')
    return INAPPROPRIATE_WORDS.includes(cleanWord)
  })
}

