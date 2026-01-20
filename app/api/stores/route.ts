import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createDefaultCategoriesForStore } from '@/lib/default-categories'

export const dynamic = 'force-dynamic'

// GET /api/stores - List all stores for the tenant
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only ADMIN can access stores
    if (session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const { searchParams } = new URL(req.url)
    const activeOnly = searchParams.get('activeOnly') === 'true'

    const where: any = { tenantId }
    if (activeOnly) {
      where.isActive = true
    }

    const stores = await prisma.store.findMany({
      where,
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
          },
        },
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ stores })
  } catch (error: any) {
    console.error('Error fetching stores:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch stores' },
      { status: 500 }
    )
  }
}

// POST /api/stores - Create a new store
export async function POST(req: NextRequest) {
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

    const body = await req.json()
    const { name, description, address, phone, email } = body

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: 'Store name is required' },
        { status: 400 }
      )
    }

    // Check if store with same name already exists
    const existingStore = await prisma.store.findFirst({
      where: {
        tenantId,
        name,
      },
    })

    if (existingStore) {
      return NextResponse.json(
        { error: 'Store with this name already exists' },
        { status: 400 }
      )
    }

    // Create store
    const store = await prisma.store.create({
      data: {
        tenantId,
        name,
        description: description || null,
        address: address || null,
        phone: phone || null,
        email: email || null,
        isActive: true,
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

    // Automatically create default categories for the new store
    try {
      await createDefaultCategoriesForStore(tenantId, store.id, prisma)
      console.log(`✓ Created default categories for store: ${store.name}`)
    } catch (categoryError) {
      // Log error but don't fail store creation
      console.error('Error creating default categories for store:', categoryError)
    }

    return NextResponse.json({ store }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating store:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create store' },
      { status: 500 }
    )
  }
}
