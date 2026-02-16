import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Get all teams
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Get storeId from query parameter (optional)
    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')

    const where: any = {
      tenantId, // Always filter by tenant
      isActive: true,
    }

    // Filter by store if provided
    if (storeId !== null && storeId !== undefined && storeId !== '') {
      where.OR = [
        { storeId: storeId }, // Store-specific teams
        { storeId: null }, // Tenant-level teams (available to all stores)
      ]
    }

    const teams = await prisma.team.findMany({
      where,
      include: {
        _count: {
          select: {
            Ticket: true,
            TeamMember: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    // Transform teams to use frontend-friendly field names
    const transformedTeams = teams.map((team: any) => ({
      ...team,
      _count: {
        tickets: team._count?.Ticket || 0,
        members: team._count?.TeamMember || 0,
      },
    }))

    return NextResponse.json({ teams: transformedTeams })
  } catch (error: any) {
    console.error('Error fetching teams:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch teams' },
      { status: 500 }
    )
  }
}

/**
 * Create a new team
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { name, description, color } = body

    if (!name) {
      return NextResponse.json(
        { error: 'Team name is required' },
        { status: 400 }
      )
    }

    const team = await prisma.team.create({
      data: {
        id: crypto.randomUUID(),
        tenantId, // Always include tenantId
        name,
        description,
        color,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({ team })
  } catch (error: any) {
    console.error('Error creating team:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create team' },
      { status: 500 }
    )
  }
}

