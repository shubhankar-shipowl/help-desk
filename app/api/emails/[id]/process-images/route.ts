import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { processInlineImages } from '@/lib/email-inline-images'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Process inline images from email HTML content
 * Extracts data URIs, uploads to Mega, and updates email HTML
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const startTime = Date.now()
  console.log('\n' + '='.repeat(80))
  console.log('📧 [Process Images API] Request received')
  console.log('='.repeat(80))

  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      console.error('❌ [Process Images API] Unauthorized - no session')
      return NextResponse.json({ 
        success: false,
        error: 'Unauthorized' 
      }, { status: 401 })
    }

    console.log('✅ [Process Images API] Session validated for user:', session.user?.email)

    // Handle both Promise and direct params (Next.js 13+ vs 15+)
    let resolvedParams: { id: string }
    try {
      resolvedParams = params instanceof Promise ? await params : params
      console.log('📝 [Process Images API] Email ID:', resolvedParams.id)
    } catch (error: any) {
      console.error('❌ [Process Images API] Error resolving params:', error)
      return NextResponse.json({
        success: false,
        error: 'Invalid email ID parameter',
        processedHtml: null,
        uploadedImages: [],
      }, { status: 400 })
    }

    if (!resolvedParams?.id) {
      console.error('❌ [Process Images API] Email ID is missing')
      return NextResponse.json({
        success: false,
        error: 'Email ID is required',
        processedHtml: null,
        uploadedImages: [],
      }, { status: 400 })
    }

    // Get the email
    let email
    try {
      console.log('🔍 [Process Images API] Fetching email from database...')
      email = await prisma.email.findUnique({
        where: { id: resolvedParams.id },
        select: {
          id: true,
          htmlContent: true,
          EmailAttachment: true,
        },
      })
      
      if (email) {
        console.log('✅ [Process Images API] Email found')
        console.log('   - HTML Content length:', email.htmlContent?.length || 0, 'chars')
        console.log('   - Existing attachments:', email.EmailAttachment?.length || 0)
      }
    } catch (error: any) {
      console.error('❌ [Process Images API] Database error fetching email:', error)
      console.error('   Error message:', error.message)
      console.error('   Error stack:', error.stack)
      return NextResponse.json({
        success: false,
        error: 'Database error: ' + (error.message || 'Failed to fetch email'),
        processedHtml: null,
        uploadedImages: [],
      }, { status: 500 })
    }

    if (!email) {
      console.error('❌ [Process Images API] Email not found:', resolvedParams.id)
      return NextResponse.json({
        success: false,
        error: 'Email not found',
        processedHtml: null,
        uploadedImages: [],
      }, { status: 404 })
    }

    // Check if HTML has data URIs or CID references
    const hasDataUris = email.htmlContent?.includes('data:image/') || email.htmlContent?.includes('data:video/')
    const hasCidReferences = email.htmlContent?.includes('cid:') || false
    
    console.log('🔍 [Process Images API] Analyzing HTML content...')
    console.log('   - Has data URIs:', hasDataUris)
    console.log('   - Has CID references:', hasCidReferences)
    
    // Check if images are already processed (no data URIs or CID refs in HTML but attachments exist)
    const existingImageAttachments = email.EmailAttachment?.filter(att => 
      att.mimeType?.startsWith('image/') || att.mimeType?.startsWith('video/')
    ) || []
    
    console.log('   - Existing image/video attachments:', existingImageAttachments.length)
    if (existingImageAttachments.length > 0) {
      existingImageAttachments.forEach((att, idx) => {
        console.log(`     ${idx + 1}. ${att.filename} (${att.mimeType}) - ${att.fileUrl ? 'Has URL' : 'No URL'}`)
      })
    }
    
    // If no data URIs or CID references, and we have image attachments, images are likely already processed
    if (!hasDataUris && !hasCidReferences) {
      // Check if HTML already has Mega URLs (already processed)
      const hasMegaUrls = email.htmlContent?.includes('/api/storage/mega/')
      console.log('   - Has Mega URLs:', hasMegaUrls)
      
      if (hasMegaUrls || existingImageAttachments.length > 0) {
        console.log('✅ [Process Images API] Images already processed - returning existing HTML')
        return NextResponse.json({
          success: true,
          message: 'Images already processed',
          processedHtml: email.htmlContent,
          uploadedImages: [],
        })
      }
      console.log('ℹ️  [Process Images API] No inline images to process')
      return NextResponse.json({
        success: true,
        message: 'No inline images to process',
        processedHtml: email.htmlContent,
        uploadedImages: [],
      })
    }

    // For CID references, try to resolve them using existing image attachments
    // If images were processed during fetch, they should have fileUrl
    if (hasCidReferences && !hasDataUris) {
      console.log('\n🔗 [Process Images API] CID references detected - attempting to resolve...')
      console.log('   - Email ID:', email.id)
      
      // Get all image/video attachments for this email
      const imageAttachments = existingImageAttachments.filter(att => att.fileUrl)
      console.log('   - Image attachments with URLs:', imageAttachments.length)
      
      if (imageAttachments.length > 0) {
        // Try to replace CID references with attachment URLs
        // Since we don't have the original CID mapping, we'll try to match by order or filename
        let processedHtml = email.htmlContent
        let replacedCount = 0
        
        // Check if HTML content exists
        if (!processedHtml) {
          console.log('   - No HTML content to process for CID references')
        } else {
          // Find all CID references in HTML
          const cidRegex = /<(img|video)[^>]+src=["']cid:([^"']+)["'][^>]*>/gi
          const cidMatches = Array.from(processedHtml.matchAll(cidRegex))
          
          console.log('   - Found CID references in HTML:', cidMatches.length)
          cidMatches.forEach((match, idx) => {
            console.log(`     ${idx + 1}. ${match[1]} tag with CID: ${match[2]}`)
          })
          
          // Replace CID references with attachment URLs
          // If we have the same number of CID refs as attachments, match by order
          // Otherwise, try to match by filename patterns
          cidMatches.forEach((match, index) => {
            const fullMatch = match[0]
            const tagType = match[1] // 'img' or 'video'
            const cid = match[2].replace(/^<|>$/g, '').trim()
            
            // Try to find matching attachment
            // First, try by index if counts match
            let attachment: typeof imageAttachments[0] | undefined = imageAttachments[index]
            
            // If not found or if it's not the right type, try to find by filename
            if (!attachment || (tagType === 'video' && !attachment.mimeType?.startsWith('video/')) || 
                (tagType === 'img' && !attachment.mimeType?.startsWith('image/'))) {
              const foundAttachment = imageAttachments.find(att => {
                const isRightType = tagType === 'video' 
                  ? att.mimeType?.startsWith('video/')
                  : att.mimeType?.startsWith('image/')
                return isRightType && att.fileUrl
              })
              if (foundAttachment) {
                attachment = foundAttachment
              }
            }
            
            if (attachment && attachment.fileUrl) {
              // Replace the CID reference with the file URL
              const replacement = fullMatch.replace(/src=["']cid:[^"']+["']/, `src="${attachment.fileUrl}"`)
              processedHtml = processedHtml!.replace(fullMatch, replacement)
              replacedCount++
              console.log(`   ✅ [Process Images API] Replaced CID "${cid}" with ${attachment.fileUrl}`)
            } else {
              console.warn(`   ⚠️  [Process Images API] Could not find matching attachment for CID: ${cid}`)
            }
          })
          
          if (replacedCount > 0) {
            console.log(`\n💾 [Process Images API] Updating email HTML with ${replacedCount} resolved CID references...`)
            // Update email HTML content
            try {
              await prisma.email.update({
                where: { id: email.id },
                data: {
                  htmlContent: processedHtml,
                },
              })
              console.log('✅ [Process Images API] Email HTML updated successfully')
            } catch (updateError: any) {
              console.error('❌ [Process Images API] Error updating email HTML:', updateError)
              console.error('   Error message:', updateError.message)
            }
            
            const duration = Date.now() - startTime
            console.log(`✅ [Process Images API] Successfully resolved ${replacedCount} CID reference(s) in ${duration}ms`)
            console.log('='.repeat(80) + '\n')
            
            return NextResponse.json({
              success: true,
              message: `Resolved ${replacedCount} CID reference(s) using existing attachments`,
              processedHtml,
              uploadedImages: [],
            })
          }
        }
      }
      
      // If we couldn't resolve CID references, still return success with original HTML
      // This allows the frontend to display the email even if images can't be resolved
      console.log(`⚠️  [Process Images API] Email ${email.id} has CID references but cannot resolve them`)
      console.log('   - Returning original HTML (images may not display)')
      const duration = Date.now() - startTime
      console.log(`ℹ️  [Process Images API] Completed in ${duration}ms`)
      console.log('='.repeat(80) + '\n')
      
      return NextResponse.json({
        success: true,
        message: 'CID references found but cannot be resolved. Original HTML returned.',
        processedHtml: email.htmlContent,
        uploadedImages: [],
      })
    }

    // Process inline images (data URIs)
    console.log('\n🖼️  [Process Images API] Processing data URI images...')
    let processedHtml: string | null = null
    let uploadedImages: Array<{ filename: string; mimeType: string; size: number; fileUrl: string; fileHandle: string }> = []
    
    try {
      console.log('   - Calling processInlineImages function...')
      const result = await processInlineImages(
        email.htmlContent,
        resolvedParams.id,
        undefined // No parsed attachments for existing emails (only data URIs can be processed)
      )
      processedHtml = result.processedHtml
      uploadedImages = result.uploadedImages
      console.log('   ✅ processInlineImages completed')
      console.log('   - Processed HTML length:', processedHtml?.length || 0)
      console.log('   - Uploaded images count:', uploadedImages.length)
    } catch (error: any) {
      console.error('❌ [Process Images API] Error in processInlineImages:', error)
      console.error('   Error message:', error.message)
      console.error('   Error stack:', error.stack)
      // Continue with original HTML if processing fails
      processedHtml = email.htmlContent
      uploadedImages = []
    }

    // Ensure we have a processedHtml to return
    const finalProcessedHtml = processedHtml || email.htmlContent || ''

    // Store uploaded images as EmailAttachment records
    console.log('\n💾 [Process Images API] Storing uploaded images as EmailAttachment records...')
    const newAttachments = []
    for (let i = 0; i < uploadedImages.length; i++) {
      const image = uploadedImages[i]
      try {
        console.log(`   [${i + 1}/${uploadedImages.length}] Processing: ${image.filename}`)
        
        // Validate image data
        if (!image.fileUrl || !image.fileHandle) {
          console.warn(`   ⚠️  Skipping image with missing fileUrl or fileHandle: ${image.filename}`)
          continue
        }

        // Check if attachment already exists (avoid duplicates)
        const existing = existingImageAttachments.find(att => 
          att.fileUrl === image.fileUrl
        )
        
        if (!existing) {
          try {
            console.log(`   - Creating EmailAttachment record for: ${image.filename}`)
            await prisma.emailAttachment.create({
              data: {
                id: randomUUID(),
                emailId: email.id,
                filename: image.filename || 'unnamed-image',
                mimeType: image.mimeType || 'image/png',
                size: image.size || 0,
                fileUrl: image.fileUrl,
                fileHandle: image.fileHandle,
              },
            })
            newAttachments.push(image)
            console.log(`   ✅ Stored: ${image.filename} -> ${image.fileUrl}`)
          } catch (dbError: any) {
            console.error(`   ❌ Database error storing attachment ${image.filename}:`, dbError.message)
            // Continue with other images even if one fails
          }
        } else {
          console.log(`   ℹ️  Attachment already exists: ${image.filename}`)
        }
      } catch (error: any) {
        console.error(`   ❌ Error processing attachment ${image.filename}:`, error.message)
        // Continue with other images
      }
    }
    console.log(`   ✅ Stored ${newAttachments.length} new attachment(s)`)

    // Update email HTML content with processed HTML if it changed
    if (finalProcessedHtml && finalProcessedHtml !== email.htmlContent) {
      console.log('\n💾 [Process Images API] Updating email HTML content in database...')
      console.log('   - Original HTML length:', email.htmlContent?.length || 0)
      console.log('   - Processed HTML length:', finalProcessedHtml.length)
      try {
        await prisma.email.update({
          where: { id: email.id },
          data: {
            htmlContent: finalProcessedHtml,
            hasAttachments: (email.EmailAttachment?.length || 0) + newAttachments.length > 0,
          },
        })
        console.log('   ✅ Email HTML updated successfully in database')
      } catch (error: any) {
        console.error('   ❌ Error updating email HTML:', error.message)
        console.error('   Error stack:', error.stack)
        // Continue even if update fails - we'll still return the processed HTML
      }
    } else {
      console.log('ℹ️  [Process Images API] HTML unchanged, skipping database update')
    }

    const duration = Date.now() - startTime
    const message = uploadedImages.length > 0 
      ? `Processed ${uploadedImages.length} inline image(s)` 
      : newAttachments.length > 0
      ? `Processed ${newAttachments.length} new image(s)`
      : 'No images to process'
    
    console.log(`\n✅ [Process Images API] Success: ${message}`)
    console.log(`⏱️  [Process Images API] Total time: ${duration}ms`)
    console.log('='.repeat(80) + '\n')

    return NextResponse.json({
      success: true,
      message,
      processedHtml: finalProcessedHtml,
      uploadedImages: newAttachments,
    }, { status: 200 })
  } catch (error: any) {
    const duration = Date.now() - startTime
    console.error('\n❌ [Process Images API] UNEXPECTED ERROR')
    console.error('='.repeat(80))
    console.error('   Error name:', error?.name)
    console.error('   Error message:', error?.message)
    console.error('   Error stack:', error?.stack)
    console.error(`   Time elapsed: ${duration}ms`)
    console.error('='.repeat(80) + '\n')
    
    // Return error response with proper structure
    return NextResponse.json(
      { 
        success: false,
        error: error?.message || 'Failed to process inline images',
        processedHtml: null,
        uploadedImages: [],
      },
      { 
        status: 500,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    )
  }
}
