import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { rating, feedback } = body

    if (!rating || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: 'Rating must be between 1 and 5' },
        { status: 400 }
      )
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const ticket = await prisma.ticket.findFirst({
      where: {
        id: params.id,
        tenantId, // Security: Only access tickets from same tenant
      },
    })

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 })
    }

    // Check if customer owns the ticket
    if (session.user.role === 'CUSTOMER' && ticket.customerId !== session.user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Check if ticket is resolved
    if (ticket.status !== 'RESOLVED' && ticket.status !== 'CLOSED') {
      return NextResponse.json(
        { error: 'Ticket must be resolved before rating' },
        { status: 400 }
      )
    }

    // Check if rating already exists
    const existingRating = await prisma.satisfactionRating.findUnique({
      where: { ticketId: params.id },
    })

    if (existingRating) {
      return NextResponse.json(
        { error: 'Rating already submitted for this ticket' },
        { status: 400 }
      )
    }

    const satisfactionRating = await prisma.satisfactionRating.create({
      data: {
        ticketId: params.id,
        rating,
        feedback: feedback || null,
        userId: session.user.id,
      },
      include: {
        ticket: {
          select: { ticketNumber: true },
        },
      },
    })

    return NextResponse.json({ rating: satisfactionRating }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating rating:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to submit rating' },
      { status: 500 }
    )
  }
}

