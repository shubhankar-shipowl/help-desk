import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Mark ticket(s) as penalized
 * Only admins can mark tickets as penalized
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { ticketIds, refundAmount } = body

    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) {
      return NextResponse.json(
        { error: 'Ticket IDs are required' },
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

    // Validate that all tickets are resolved
    const tickets = await prisma.ticket.findMany({
      where: {
        tenantId, // Security: Only access tickets from same tenant
        id: { in: ticketIds },
      },
      select: {
        id: true,
        status: true,
        ticketNumber: true,
      },
    })

    const unresolvedTickets = tickets.filter((t: any) => t.status !== 'RESOLVED')
    if (unresolvedTickets.length > 0) {
      return NextResponse.json(
        {
          error: 'Only resolved tickets can be marked as penalized',
          unresolvedTickets: unresolvedTickets.map((t: any) => t.ticketNumber),
        },
        { status: 400 }
      )
    }

    // Update tickets
    const updatedTickets = await prisma.ticket.updateMany({
      where: {
        tenantId, // Security: Only update tickets from same tenant
        id: { in: ticketIds },
        status: 'RESOLVED',
      },
      data: {
        isPenalized: true,
        penalizedAt: new Date(),
        penalizedBy: session.user.id,
        refundAmount: refundAmount ? parseFloat(refundAmount.toString()) : null,
      },
    })

    // Log activity for each ticket
    await Promise.all(
      ticketIds.map((ticketId: string) =>
        prisma.ticketActivity.create({
          data: {
            id: crypto.randomUUID(),
            ticketId,
            userId: session.user.id,
            action: 'penalized',
            description: `Ticket marked as penalized${refundAmount ? ` with refund amount: ${refundAmount}` : ''}`,
            metadata: {
              refundAmount: refundAmount || null,
              penalizedAt: new Date().toISOString(),
            },
          },
        })
      )
    )

    return NextResponse.json({
      success: true,
      message: `${updatedTickets.count} ticket(s) marked as penalized`,
      count: updatedTickets.count,
    })
  } catch (error: any) {
    console.error('Error penalizing tickets:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to penalize tickets' },
      { status: 500 }
    )
  }
}

/**
 * Remove penalization from ticket(s)
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const ticketIds = searchParams.get('ticketIds')?.split(',') || []

    if (ticketIds.length === 0) {
      return NextResponse.json(
        { error: 'Ticket IDs are required' },
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

    const updatedTickets = await prisma.ticket.updateMany({
      where: {
        tenantId, // Security: Only update tickets from same tenant
        id: { in: ticketIds },
      },
      data: {
        isPenalized: false,
        penalizedAt: null,
        penalizedBy: null,
        refundAmount: null,
      },
    })

    return NextResponse.json({
      success: true,
      message: `${updatedTickets.count} ticket(s) unpenalized`,
      count: updatedTickets.count,
    })
  } catch (error: any) {
    console.error('Error unpenalizing tickets:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to unpenalize tickets' },
      { status: 500 }
    )
  }
}

