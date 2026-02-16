import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
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

    const { id } = await Promise.resolve(params)
    const body = await req.json()
    const { name, icon, subjects } = body

    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Build the data object conditionally
    const categoryData: {
      name: string
      icon?: string | null
      subjects?: any
    } = {
      name,
      icon: icon || null,
      subjects: subjects && Array.isArray(subjects) && subjects.length > 0 ? subjects : undefined,
    }

    const category = await prisma.category.update({
      where: {
        id,
        tenantId, // Security: Only update categories from same tenant
      },
      data: categoryData,
    })

    return NextResponse.json({ category })
  } catch (error: any) {
    console.error('Error updating category:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update category' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
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

    const { id } = await Promise.resolve(params)

    // Check if category has tickets (filtered by tenant)
    const ticketCount = await prisma.ticket.count({
      where: {
        categoryId: id,
        tenantId, // Filter by tenant
      },
    })

    if (ticketCount > 0) {
      return NextResponse.json(
        { error: `Cannot delete category. It has ${ticketCount} ticket(s) associated with it.` },
        { status: 400 }
      )
    }

    // Delete the category
    await prisma.category.delete({
      where: {
        id,
        tenantId, // Security: Only delete categories from same tenant
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting category:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete category' },
      { status: 500 }
    )
  }
}

