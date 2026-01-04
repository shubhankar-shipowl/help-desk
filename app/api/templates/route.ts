import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

/**
 * Get templates (canned responses)
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

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type') || 'CANNED_RESPONSE'
    const category = searchParams.get('category')
    const search = searchParams.get('search')

    const where: any = {
      tenantId, // Always filter by tenant
      type,
      isActive: true,
    }

    if (category) {
      where.category = category
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { content: { contains: search, mode: 'insensitive' } },
      ]
    }

    const templates = await prisma.template.findMany({
      where,
      orderBy: [
        { usageCount: 'desc' },
        { name: 'asc' },
      ],
    })

    return NextResponse.json({ templates })
  } catch (error: any) {
    console.error('Error fetching templates:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch templates' },
      { status: 500 }
    )
  }
}

/**
 * Create template
 */
export async function POST(req: NextRequest) {
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

    const body = await req.json()
    const { name, content, type, category, variables } = body

    if (!name || !content) {
      return NextResponse.json(
        { error: 'Name and content are required' },
        { status: 400 }
      )
    }

    const template = await prisma.template.create({
      data: {
        tenantId, // Always include tenantId
        name,
        content,
        type: type || 'CANNED_RESPONSE',
        category: category || null,
        variables: variables || {},
      },
    })

    return NextResponse.json({ template })
  } catch (error: any) {
    console.error('Error creating template:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create template' },
      { status: 500 }
    )
  }
}

/**
 * Update template
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { id, name, content, category, variables, isActive } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Template ID is required' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (name !== undefined) updateData.name = name
    if (content !== undefined) updateData.content = content
    if (category !== undefined) updateData.category = category
    if (variables !== undefined) updateData.variables = variables
    if (isActive !== undefined) updateData.isActive = isActive

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const template = await prisma.template.update({
      where: {
        id,
        tenantId, // Security: Only update templates from same tenant
      },
      data: updateData,
    })

    return NextResponse.json({ template })
  } catch (error: any) {
    console.error('Error updating template:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update template' },
      { status: 500 }
    )
  }
}

/**
 * Increment template usage count
 */
export async function PUT(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { id } = body

    if (!id) {
      return NextResponse.json(
        { error: 'Template ID is required' },
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

    const template = await prisma.template.update({
      where: {
        id,
        tenantId, // Security: Only update templates from same tenant
      },
      data: {
        usageCount: {
          increment: 1,
        },
      },
    })

    return NextResponse.json({ template })
  } catch (error: any) {
    console.error('Error incrementing template usage:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to increment usage' },
      { status: 500 }
    )
  }
}

/**
 * Delete template
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
        { error: 'Template ID is required' },
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

    await prisma.template.delete({
      where: {
        id,
        tenantId, // Security: Only delete templates from same tenant
      },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting template:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete template' },
      { status: 500 }
    )
  }
}

