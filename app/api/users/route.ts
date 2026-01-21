import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

// Get users/agents (for admins and agents)
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Only ADMIN and AGENT can access this endpoint
    if (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const { searchParams } = new URL(req.url)
    const role = searchParams.get('role')
    const storeId = searchParams.get('storeId')

    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    const where: any = {
      tenantId, // Always filter by tenant
    }
    
    // For admins, storeId is required to filter data by store
    if (session.user.role === 'ADMIN') {
      if (!storeId) {
        return NextResponse.json(
          { error: 'Store ID is required for admin users' },
          { status: 400 }
        )
      }
      // For customers, filter by tickets' storeId, not user's storeId
      // For agents/admins, filter by user's storeId
      if (role && role.toUpperCase() === 'CUSTOMER') {
        // Customers are filtered by their tickets' storeId
        // We'll filter this after fetching
      } else {
        where.storeId = storeId
      }
    } else if (storeId) {
      // For agents, storeId is optional
      // For customers, filter by tickets' storeId
      if (role && role.toUpperCase() === 'CUSTOMER') {
        // Customers are filtered by their tickets' storeId
        // We'll filter this after fetching
      } else {
        where.storeId = storeId
      }
    }
    
    if (role) {
      where.role = role.toUpperCase()
    }

    // If user is AGENT (not ADMIN), only return active agents
    if (session.user.role === 'AGENT') {
      where.isActive = true
      // Agents can only see other agents, not admins
      if (!role || role.toUpperCase() === 'AGENT') {
        where.role = 'AGENT'
      } else {
        // Agents cannot see other roles
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    let users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        company: true,
        isActive: true,
        storeId: true,
        Store: {
          select: {
            id: true,
            name: true,
          },
        },
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    })

    // For customers, filter by tickets' storeId if storeId is provided
    if (role && role.toUpperCase() === 'CUSTOMER' && storeId) {
      // Get customer IDs who have tickets in this store
      const customersWithTickets = await prisma.ticket.findMany({
        where: {
          tenantId,
          storeId,
          customerId: { in: users.map(u => u.id) },
        },
        select: {
          customerId: true,
        },
        distinct: ['customerId'],
      })
      
      const customerIds = new Set(customersWithTickets.map(t => t.customerId))
      users = users.filter(u => customerIds.has(u.id))
    }

    // Transform users to use frontend-friendly field names
    const transformedUsers = users.map((user: any) => ({
      ...user,
      store: user.Store || null,
    }))

    return NextResponse.json({ users: transformedUsers })
  } catch (error: any) {
    console.error('Error fetching users:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch users' },
      { status: 500 }
    )
  }
}

// Only admins can create users (agents)
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { email, name, password, role, phone, company, storeId } = body

    // Validate required fields
    if (!email || !name || !password) {
      return NextResponse.json(
        { error: 'Email, name, and password are required' },
        { status: 400 }
      )
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Only admins can create agents or other admins
    // Regular users (CUSTOMER) cannot be created through this endpoint
    if (role && role !== 'ADMIN' && role !== 'AGENT') {
      return NextResponse.json(
        { error: 'Only ADMIN and AGENT roles can be created by admins' },
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

    // Check if trying to create an admin
    const requestedRole = (role || 'AGENT').toUpperCase()
    
    // Only one admin allowed per tenant
    if (requestedRole === 'ADMIN') {
      const existingAdmin = await prisma.user.findFirst({
        where: {
          tenantId,
          role: 'ADMIN',
          isActive: true,
        },
      })

      if (existingAdmin) {
        return NextResponse.json(
          { error: 'Only one admin is allowed per tenant. An admin already exists for this tenant.' },
          { status: 400 }
        )
      }
    }

    // Check if user already exists in this tenant
    const existingUser = await prisma.user.findFirst({
      where: {
        tenantId,
        email,
      },
    })

    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      )
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10)

    // Create user (agent or admin)
    const user = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        tenantId, // Always include tenantId
        email,
        name,
        password: hashedPassword,
        role: (role || 'AGENT').toUpperCase() as 'ADMIN' | 'AGENT',
        phone: phone || null,
        company: company || null,
        storeId: storeId || null, // Assign to store if provided
        isActive: true,
        updatedAt: new Date(),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        company: true,
        isActive: true,
        storeId: true,
        Store: {
          select: {
            id: true,
            name: true,
          },
        },
        createdAt: true,
      },
    })

    // Transform user to use frontend-friendly field names
    const transformedUser = {
      ...user,
      store: user.Store || null,
    }

    return NextResponse.json({ user: transformedUser }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create user' },
      { status: 500 }
    )
  }
}

