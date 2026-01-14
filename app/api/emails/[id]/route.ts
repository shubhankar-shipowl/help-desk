import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Mark email as read
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const email = await prisma.email.update({
      where: { id: params.id },
      data: {
        read: true,
        readAt: new Date(),
      },
    })

    return NextResponse.json({ success: true, email })
  } catch (error: any) {
    console.error('Error marking email as read:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to mark email as read' },
      { status: 500 }
    )
  }
}
