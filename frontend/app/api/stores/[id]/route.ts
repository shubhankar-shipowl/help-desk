import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// GET /api/stores/:id - Get store details
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)
    
    // For public access (no session), try to detect tenant from domain/subdomain
    let tenantId: string | null = null
    
    if (session) {
      // Authenticated user - use their tenantId
      tenantId = (session.user as any).tenantId
      
      // Only ADMIN can access stores when authenticated
      if (session.user.role !== 'ADMIN') {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else {
      // Public access - detect tenant from domain/subdomain
      const hostname = req.headers.get('host') || ''
      const subdomain = hostname.split('.')[0]
      const tenant = await prisma.tenant.findUnique({
        where: { slug: subdomain },
      })
      tenantId = tenant?.id || null
      
      // If no tenant found from subdomain, use default tenant
      if (!tenantId) {
        const defaultTenant = await prisma.tenant.findUnique({
          where: { slug: 'default' },
        })
        tenantId = defaultTenant?.id || null
      }
    }

    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const resolvedParams = await Promise.resolve(params)
    const storeId = resolvedParams.id

    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      )
    }

    const store = await prisma.store.findFirst({
      where: {
        id: storeId,
        tenantId, // Ensure store belongs to the tenant
      },
      select: {
        id: true,
        name: true,
        description: true,
        address: true,
        phone: true,
        email: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: {
          select: {
            User: true,
            Ticket: true,
            Team: true,
            Category: true,
          },
        },
      },
    })

    if (!store) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    return NextResponse.json({ store })
  } catch (error: any) {
    console.error('Error fetching store:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch store' },
      { status: 500 }
    )
  }
}

// PUT /api/stores/:id - Update store
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const resolvedParams = await Promise.resolve(params)
    const storeId = resolvedParams.id

    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      )
    }

    const body = await req.json()
    const { name, description, address, phone, email, isActive } = body

    // Check if store exists and belongs to tenant
    const existingStore = await prisma.store.findFirst({
      where: {
        id: storeId,
        tenantId,
      },
    })

    if (!existingStore) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    // If name is being changed, check for duplicates
    if (name && name !== existingStore.name) {
      const duplicateStore = await prisma.store.findFirst({
        where: {
          tenantId,
          name,
          id: { not: storeId },
        },
      })

      if (duplicateStore) {
        return NextResponse.json(
          { error: 'Store with this name already exists' },
          { status: 400 }
        )
      }
    }

    // Update store
    const store = await prisma.store.update({
      where: { id: storeId },
      data: {
        name: name || existingStore.name,
        description: description !== undefined ? description : existingStore.description,
        address: address !== undefined ? address : existingStore.address,
        phone: phone !== undefined ? phone : existingStore.phone,
        email: email !== undefined ? email : existingStore.email,
        isActive: isActive !== undefined ? isActive : existingStore.isActive,
      },
      select: {
        id: true,
        name: true,
        description: true,
        address: true,
        phone: true,
        email: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    return NextResponse.json({ store })
  } catch (error: any) {
    console.error('Error updating store:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update store' },
      { status: 500 }
    )
  }
}

// DELETE /api/stores/:id - Delete store (hard delete or soft delete based on query param)
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // Resolve params (handles both Promise and direct object)
    const resolvedParams = await Promise.resolve(params)
    const storeId = resolvedParams.id

    if (!storeId) {
      return NextResponse.json(
        { error: 'Store ID is required' },
        { status: 400 }
      )
    }

    // Check if store exists and belongs to tenant
    const existingStore = await prisma.store.findFirst({
      where: {
        id: storeId,
        tenantId,
      },
      include: {
        _count: {
          select: {
            User: true,
            Ticket: true,
            Category: true,
            Team: true,
          },
        },
      },
    })

    if (!existingStore) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    // Check query parameter for hard delete
    const { searchParams } = new URL(req.url)
    const hardDelete = searchParams.get('hard') === 'true'

    if (hardDelete) {
      // Hard delete: Remove store associations and delete the store
      // Use a transaction to ensure all operations complete atomically and use a single connection
      // Sequential execution within transaction to avoid connection pool exhaustion
      await prisma.$transaction(async (tx: any) => {
        // Set storeId to null for all related records (sequential execution)
        await tx.user.updateMany({
          where: { storeId: storeId },
          data: { storeId: null },
        })

        await tx.ticket.updateMany({
          where: { storeId: storeId },
          data: { storeId: null },
        })

        await tx.category.updateMany({
          where: { storeId: storeId },
          data: { storeId: null },
        })

        await tx.team.updateMany({
          where: { storeId: storeId },
          data: { storeId: null },
        })

        await tx.tag.updateMany({
          where: { storeId: storeId },
          data: { storeId: null },
        })

        await tx.template.updateMany({
          where: { storeId: storeId },
          data: { storeId: null },
        })

        await tx.autoAssignmentRule.updateMany({
          where: { storeId: storeId },
          data: { storeId: null },
        })

        await tx.systemSettings.updateMany({
          where: { storeId: storeId },
          data: { storeId: null },
        })

        // Now delete the store
        await tx.store.delete({
          where: { id: storeId },
        })
      }, {
        timeout: 30000, // 30 second timeout for the transaction
        maxWait: 10000, // Maximum time to wait for a connection from the pool
      })

      return NextResponse.json({ 
        message: 'Store deleted permanently',
      })
    } else {
      // Soft delete by setting isActive = false
      const store = await prisma.store.update({
        where: { id: storeId },
        data: { isActive: false },
        select: {
          id: true,
          name: true,
          isActive: true,
        },
      })

      return NextResponse.json({ 
        message: 'Store deactivated successfully',
        store 
      })
    }
  } catch (error: any) {
    console.error('Error deleting store:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete store' },
      { status: 500 }
    )
  }
}
