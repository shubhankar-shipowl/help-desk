import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    
    // Get tenantId from session (multi-tenant support)
    // For public access, we might need to detect tenant from domain/subdomain
    let tenantId: string | null = null
    
    if (session) {
      tenantId = (session.user as any).tenantId
    } else {
      // Try to detect tenant from domain/subdomain (for public routes)
      const hostname = req.headers.get('host') || ''
      const subdomain = hostname.split('.')[0]
      const tenant = await prisma.tenant.findUnique({
        where: { slug: subdomain },
      })
      tenantId = tenant?.id || null
      
      // If no tenant found from subdomain, use default tenant (for public access)
      if (!tenantId) {
        const defaultTenant = await prisma.tenant.findUnique({
          where: { slug: 'default' },
        })
        tenantId = defaultTenant?.id || null
      }
    }

    if (!tenantId) {
      // If still no tenantId, return empty array instead of error (for public access)
      return NextResponse.json({ categories: [] })
    }

    // Get storeId from query parameter (optional)
    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')

    // Build where clause
    const where: any = {
      tenantId, // Filter by tenant
    }
    
    // For admins, storeId is required to filter data by store
    if (session && session.user.role === 'ADMIN') {
      if (!storeId) {
        // Return empty array for admins without storeId selection
        return NextResponse.json({ categories: [] })
      }
      where.OR = [
        { storeId: storeId }, // Store-specific categories
        { storeId: null }, // Tenant-level categories (available to all stores)
      ]
    } else if (storeId) {
      // For agents and others, storeId is optional
      where.OR = [
        { storeId: storeId }, // Store-specific categories
        { storeId: null }, // Tenant-level categories (available to all stores)
      ]
    }

    // Get all categories for this tenant (and store if specified)
    const allCategories = await prisma.category.findMany({
      where,
      orderBy: { name: 'asc' },
    })

    // Remove duplicates by ID (most reliable)
    const seenIds = new Set<string>()
    const uniqueCategories = allCategories.filter((category: any) => {
      if (seenIds.has(category.id)) {
        return false // Skip duplicate ID
      }
      seenIds.add(category.id)
      return true
    })

    // Also remove duplicates by name (case-insensitive)
    const seenNames = new Set<string>()
    const finalCategories = uniqueCategories.filter((category: any) => {
      const nameLower = category.name.toLowerCase().trim()
      if (seenNames.has(nameLower)) {
        return false // Skip duplicate name
      }
      seenNames.add(nameLower)
      return true
    })

    return NextResponse.json({ categories: finalCategories })
  } catch (error: any) {
    console.error('Error fetching categories:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch categories' },
      { status: 500 }
    )
  }
}

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
    const { name, description, parentId, color, icon, subjects } = body

    if (!name) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      )
    }

    // Build the data object conditionally
    const categoryData: any = {
      tenantId, // Always include tenantId
      name,
      description: description || null,
      color: color || null,
      icon: icon || null,
      subjects: subjects && Array.isArray(subjects) && subjects.length > 0 ? subjects : null,
    }

    // Only include parentId if it's provided and not null
    if (parentId) {
      categoryData.parentId = parentId
    }

    const category = await prisma.category.create({
      data: categoryData,
    })

    return NextResponse.json({ category }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating category:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create category' },
      { status: 500 }
    )
  }
}

