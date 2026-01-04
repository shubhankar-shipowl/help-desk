import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'

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

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        company: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { name: 'asc' },
    })

    return NextResponse.json({ users })
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
    const { email, name, password, role, phone, company } = body

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
        tenantId, // Always include tenantId
        email,
        name,
        password: hashedPassword,
        role: (role || 'AGENT').toUpperCase() as 'ADMIN' | 'AGENT',
        phone: phone || null,
        company: company || null,
        isActive: true,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        phone: true,
        company: true,
        isActive: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ user }, { status: 201 })
  } catch (error: any) {
    console.error('Error creating user:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create user' },
      { status: 500 }
    )
  }
}

