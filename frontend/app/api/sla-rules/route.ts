import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Ticket_priority } from '@prisma/client'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Get all SLA rules
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const teamId = searchParams.get('teamId')

    const where: any = {}
    if (teamId) {
      where.teamId = teamId
    }

    const rules = await prisma.sLARule.findMany({
      where,
      include: {
        Team: {
          select: {
            id: true,
            name: true,
            color: true,
          },
        },
      },
      orderBy: [
        { teamId: 'asc' },
        { priority: 'asc' },
      ],
    })

    return NextResponse.json({ rules })
  } catch (error: any) {
    console.error('Error fetching SLA rules:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch SLA rules' },
      { status: 500 }
    )
  }
}

/**
 * Create or update SLA rule
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { teamId, priority, responseTime, resolutionTime, isActive } = body

    if (!priority || !responseTime || !resolutionTime) {
      return NextResponse.json(
        { error: 'Priority, responseTime, and resolutionTime are required' },
        { status: 400 }
      )
    }

    // Check if rule already exists
    const existing = await prisma.sLARule.findUnique({
      where: {
        teamId_priority: {
          teamId: teamId || null,
          priority: priority as Ticket_priority,
        },
      },
    })

    if (existing) {
      // Update existing rule
      const rule = await prisma.sLARule.update({
        where: { id: existing.id },
        data: {
          responseTime,
          resolutionTime,
          isActive: isActive !== undefined ? isActive : true,
          updatedAt: new Date(),
        },
        include: {
          Team: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
        },
      })

      return NextResponse.json({ rule })
    } else {
      // Create new rule
      const rule = await prisma.sLARule.create({
        data: {
          id: crypto.randomUUID(),
          teamId: teamId || null,
          priority: priority as Ticket_priority,
          responseTime,
          resolutionTime,
          isActive: isActive !== undefined ? isActive : true,
          updatedAt: new Date(),
        },
        include: {
          Team: {
            select: {
              id: true,
              name: true,
              color: true,
            },
          },
        },
      })

      return NextResponse.json({ rule })
    }
  } catch (error: any) {
    console.error('Error creating/updating SLA rule:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create/update SLA rule' },
      { status: 500 }
    )
  }
}

/**
 * Delete SLA rule
 */
export async function DELETE(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')

    if (!id) {
      return NextResponse.json(
        { error: 'SLA rule ID is required' },
        { status: 400 }
      )
    }

    await prisma.sLARule.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting SLA rule:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete SLA rule' },
      { status: 500 }
    )
  }
}

