import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()

    // Get tenantId from session (multi-tenant support) - must be at the top
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }

    // For admins updating themselves, use session user ID to avoid ID mismatch issues
    // This ensures we always use the correct user ID from the session
    const targetId = (session.user.role === 'ADMIN' && session.user.id === id) ? session.user.id : id

    // Check authorization: Admins can update any user, others can only update themselves
    const isAdmin = session.user.role === 'ADMIN'
    const isUpdatingSelf = session.user.id === targetId

    if (!isAdmin && !isUpdatingSelf) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Build update data
    const updateData: any = {}

    // Only admins can update these fields
    if (isAdmin) {
      if (body.isActive !== undefined) {
        updateData.isActive = body.isActive
      }

      if (body.name !== undefined) {
        updateData.name = body.name
      }

      if (body.email !== undefined) {
        // Check if email already exists for another user in this tenant
        const existingUser = await prisma.user.findFirst({
          where: {
            tenantId, // Filter by tenant
            email: body.email,
            id: { not: id },
          },
        })

        if (existingUser) {
          return NextResponse.json({ error: 'Email already in use' }, { status: 400 })
        }

        updateData.email = body.email
      }

      if (body.role !== undefined) {
        // Prevent changing your own role
        if (session.user.id === id && body.role !== session.user.role) {
          return NextResponse.json(
            { error: 'Cannot change your own role' },
            { status: 400 }
          )
        }
        
        // Only one admin allowed per tenant
        if (body.role === 'ADMIN') {
          const existingAdmin = await prisma.user.findFirst({
            where: {
              tenantId,
              role: 'ADMIN',
              isActive: true,
              id: { not: id }, // Exclude the current user being updated
            },
          })

          if (existingAdmin) {
            return NextResponse.json(
              { error: 'Only one admin is allowed per tenant. An admin already exists for this tenant.' },
              { status: 400 }
            )
          }
        }
        
        updateData.role = body.role
      }
    } else {
      // Non-admin users can only update their own name
      if (body.name !== undefined) {
        updateData.name = body.name
      }
    }

    // All authenticated users (including agents) can update their own phone number
    if (body.phone !== undefined) {
      updateData.phone = body.phone
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
    }

    // Verify user exists before updating - use targetId which may be session user ID for admins
    // Also verify user belongs to same tenant
    const existingUser = await prisma.user.findFirst({
      where: {
        id: targetId,
        tenantId, // Security: Only access users from same tenant
      },
    })

    if (!existingUser) {
      console.error(`[User Update] User not found: ${targetId}, Request ID: ${id}, Session user ID: ${session.user.id}, Role: ${session.user.role}`)
      // If admin is updating themselves and the requested ID doesn't exist, try using session ID
      if (isAdmin && isUpdatingSelf && targetId !== session.user.id) {
        const sessionUser = await prisma.user.findUnique({
          where: { id: session.user.id },
        })
        if (sessionUser) {
          // Use session user ID instead
          const user = await prisma.user.update({
            where: { id: session.user.id },
            data: updateData,
          })
          return NextResponse.json({ user })
        }
      }
      return NextResponse.json({ 
        error: 'User not found. Please refresh the page and try again.',
        details: `User ID ${targetId} does not exist in the database.`
      }, { status: 404 })
    }

    // For non-admin users, ensure they can only update their own record
    if (session.user.role !== 'ADMIN' && session.user.id !== targetId) {
      return NextResponse.json({ error: 'Unauthorized: You can only update your own profile' }, { status: 403 })
    }

    const user = await prisma.user.update({
      where: { id: targetId },
      data: updateData,
    })

    return NextResponse.json({ user })
  } catch (error: any) {
    console.error('Error updating user:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update user' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params

    // Prevent deleting yourself
    if (session.user.id === id) {
      return NextResponse.json(
        { error: 'Cannot delete your own account' },
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

    // Check if user exists and belongs to same tenant
    const user = await prisma.user.findFirst({
      where: {
        id,
        tenantId, // Security: Only access users from same tenant
      },
      include: {
        _count: {
          select: {
            tickets: true,
            assignedTickets: true,
          },
        },
      },
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Prevent deleting users with tickets (optional - you can change this)
    if (user._count.tickets > 0 || user._count.assignedTickets > 0) {
      return NextResponse.json(
        { error: 'Cannot delete user with existing tickets. Deactivate instead.' },
        { status: 400 }
      )
    }

    await prisma.user.delete({
      where: { id },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting user:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to delete user' },
      { status: 500 }
    )
  }
}

