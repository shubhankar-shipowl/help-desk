import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { downloadFileFromMega, getFileMetadata } from '@/lib/storage/mega'
import { prisma } from '@/lib/prisma'

/**
 * Serve files from MEGA storage (authenticated, private)
 * This endpoint ensures only authenticated users can access files
 * 
 * IMPORTANT: MEGA is used as private storage, NOT as CDN
 * All file access must go through this authenticated endpoint
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ fileHandle: string }> }
) {
  try {
    // Require authentication
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await Promise.resolve(params)
    const fileHandle = resolvedParams.fileHandle

    if (!fileHandle) {
      return NextResponse.json({ error: 'File handle is required' }, { status: 400 })
    }

    // Optional: Verify user has access to this file (check if it's associated with a ticket they can access)
    // This adds an extra layer of security
    const tenantId = (session.user as any).tenantId
    if (tenantId) {
      // Check if file is associated with a ticket in user's tenant
      const attachment = await prisma.attachment.findFirst({
        where: {
          fileUrl: {
            contains: fileHandle,
          },
          OR: [
            {
              ticket: {
                tenantId,
              },
            },
            {
              comment: {
                ticket: {
                  tenantId,
                },
              },
            },
          ],
        },
        include: {
          ticket: {
            select: {
              id: true,
              tenantId: true,
            },
          },
        },
      })

      // If attachment found, verify user has access
      if (attachment) {
        // Admin and agents can access all tickets in their tenant
        // Customers can only access their own tickets
        if (session.user.role === 'CUSTOMER') {
          const ticket = await prisma.ticket.findUnique({
            where: { id: attachment.ticketId || '' },
            select: { customerId: true },
          })

          if (ticket && ticket.customerId !== session.user.id) {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
          }
        }
      }
    }

    // Get file metadata
    const metadata = await getFileMetadata(fileHandle)

    // Download file from MEGA
    const fileBuffer = await downloadFileFromMega(fileHandle)

    // Determine content type
    const extension = metadata.name.split('.').pop()?.toLowerCase()
    const contentTypeMap: Record<string, string> = {
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'png': 'image/png',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'webm': 'video/webm',
      'ogg': 'video/ogg',
      'mpeg': 'video/mpeg',
      'mpg': 'video/mpeg',
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'txt': 'text/plain',
      'zip': 'application/zip',
    }

    const contentType = metadata.mimeType || contentTypeMap[extension || ''] || 'application/octet-stream'

    // Return file with appropriate headers
    return new NextResponse(fileBuffer as any, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${metadata.name}"`,
        'Content-Length': fileBuffer.length.toString(),
        'Cache-Control': 'private, max-age=3600', // Private cache (not public CDN)
      },
    })
  } catch (error: any) {
    console.error('[MEGA Storage API] Error serving file:', error)
    
    if (error.message?.includes('not found')) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    
    return NextResponse.json(
      { error: error.message || 'Failed to serve file' },
      { status: 500 }
    )
  }
}

