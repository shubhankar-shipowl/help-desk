import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get all auto-assignment rules
 */
export async function GET(req: NextRequest) {
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

    const rules = await prisma.autoAssignmentRule.findMany({
      where: {
        tenantId, // Always filter by tenant
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
    })

    return NextResponse.json({ rules })
  } catch (error: any) {
    console.error('Error fetching auto-assignment rules:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch rules' },
      { status: 500 }
    )
  }
}

/**
 * Create a new auto-assignment rule
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
    const { name, description, conditions, actions, priority, isActive } = body

    if (!name || !conditions || !actions) {
      return NextResponse.json(
        { error: 'Name, conditions, and actions are required' },
        { status: 400 }
      )
    }

    const rule = await prisma.autoAssignmentRule.create({
      data: {
        tenantId, // Always include tenantId
        name,
        description,
        conditions: conditions || {},
        actions: actions || {},
        priority: priority || 0,
        isActive: isActive !== undefined ? isActive : true,
      },
    })

    return NextResponse.json({ rule })
  } catch (error: any) {
    console.error('Error creating auto-assignment rule:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create rule' },
      { status: 500 }
    )
  }
}

/**
 * Update an auto-assignment rule
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { id, name, description, conditions, actions, priority, isActive } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Rule ID is required' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (conditions !== undefined) updateData.conditions = conditions
    if (actions !== undefined) updateData.actions = actions
    if (priority !== undefined) updateData.priority = priority
    if (isActive !== undefined) updateData.isActive = isActive

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const rule = await prisma.autoAssignmentRule.update({
      where: {
        id,
        tenantId, // Security: Only update rules from same tenant
      },
      data: updateData,
    })

    return NextResponse.json({ rule })
  } catch (error: any) {
    console.error('Error updating auto-assignment rule:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update rule' },
      { status: 500 }
    )
  }
}

/**
 * Delete an auto-assignment rule
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
        { error: 'Rule ID is required' },
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

    await prisma.autoAssignmentRule.delete({
      where: {
        id,
        tenantId, // Security: Only delete rules from same tenant
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting auto-assignment rule:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete rule' },
      { status: 500 }
    )
  }
}

