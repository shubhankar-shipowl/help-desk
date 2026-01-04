import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  try {
    const resolvedParams = await Promise.resolve(params)
    const filePath = resolvedParams.path.join('/')
    
    // Security: Prevent directory traversal
    if (filePath.includes('..') || filePath.includes('//')) {
      return NextResponse.json({ error: 'Invalid file path' }, { status: 400 })
    }
    
    // Construct full file path
    const fullPath = join(process.cwd(), 'uploads', filePath)
    
    // Check if file exists
    if (!existsSync(fullPath)) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }
    
    // Read file
    const fileBuffer = await readFile(fullPath)
    
    // Determine content type from file extension
    const extension = filePath.split('.').pop()?.toLowerCase()
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
    
    const contentType = contentTypeMap[extension || ''] || 'application/octet-stream'
    
    // Return file with appropriate headers
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `inline; filename="${filePath.split('/').pop()}"`,
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    })
  } catch (error: any) {
    console.error('Error serving file:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to serve file' },
      { status: 500 }
    )
  }
}

