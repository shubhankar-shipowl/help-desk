import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { uploadFileToMega } from '@/lib/storage/mega'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const resolvedParams = await Promise.resolve(params)
    const ticketId = resolvedParams.id

    // Verify ticket exists
    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    const contentType = req.headers.get('content-type') || ''
    if (!contentType.includes('multipart/form-data')) {
      return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
    }

    const formData = await req.formData()
    const files = formData.getAll('attachments') as File[]
    const validFiles = files.filter(file => file instanceof File && file.size > 0)

    if (validFiles.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }

    const uploaded: Array<{ filename: string; url: string }> = []

    for (const file of validFiles) {
      try {
        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)

        const uploadResult = await uploadFileToMega(
          buffer,
          file.name,
          file.type || 'application/octet-stream',
          ticketId
        )

        await prisma.attachment.create({
          data: {
            id: crypto.randomUUID(),
            filename: file.name,
            fileUrl: uploadResult.fileUrl,
            fileSize: uploadResult.fileSize,
            mimeType: uploadResult.mimeType,
            ticketId,
          },
        })

        uploaded.push({ filename: file.name, url: uploadResult.fileUrl })
      } catch (fileError: any) {
        console.error(`Failed to upload ${file.name}:`, fileError.message)
      }
    }

    return NextResponse.json({
      success: true,
      uploaded: uploaded.length,
      files: uploaded,
    })
  } catch (error: any) {
    console.error('Error uploading attachments:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to upload attachments' },
      { status: 500 }
    )
  }
}
