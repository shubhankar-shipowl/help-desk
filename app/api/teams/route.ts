import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

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

    const teams = await prisma.team.findMany({
      where: {
        tenantId, // Always filter by tenant
        isActive: true,
      },
      include: {
        _count: {
          select: {
            tickets: true,
            members: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ teams })
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
        tenantId, // Always include tenantId
        name,
        description,
        color,
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

