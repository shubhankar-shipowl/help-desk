import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

/**
 * Get notification templates
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const type = searchParams.get('type')
    const channel = searchParams.get('channel')

    const where: any = {}
    if (type) where.type = type
    if (channel) where.channel = channel

    const templates = await prisma.notificationTemplate.findMany({
      where,
      orderBy: { type: 'asc' },
    })

    return NextResponse.json({ templates })
  } catch (error: any) {
    console.error('Error fetching notification templates:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch templates' },
      { status: 500 }
    )
  }
}

/**
 * Create or update notification template
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { type, channel, subject, bodyTemplate, htmlTemplate, variables, isActive } = body

    if (!type || !channel) {
      return NextResponse.json(
        { error: 'Type and channel are required' },
        { status: 400 }
      )
    }

    const template = await prisma.notificationTemplate.upsert({
      where: { type },
      update: {
        channel,
        subject,
        bodyTemplate,
        htmlTemplate,
        variables: variables || {},
        isActive: isActive !== undefined ? isActive : true,
        updatedAt: new Date(),
      },
      create: {
        id: crypto.randomUUID(),
        type,
        channel,
        subject,
        bodyTemplate: bodyTemplate || '',
        htmlTemplate,
        variables: variables || {},
        isActive: isActive !== undefined ? isActive : true,
        updatedAt: new Date(),
      },
    })

    return NextResponse.json({ template })
  } catch (error: any) {
    console.error('Error creating/updating notification template:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to save template' },
      { status: 500 }
    )
  }
}

/**
 * Update notification template
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || session.user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { type, channel, subject, bodyTemplate, htmlTemplate, variables, isActive } = body

    if (!type) {
      return NextResponse.json(
        { error: 'Template type is required' },
        { status: 400 }
      )
    }

    const updateData: any = {}
    if (channel !== undefined) updateData.channel = channel
    if (subject !== undefined) updateData.subject = subject
    if (bodyTemplate !== undefined) updateData.bodyTemplate = bodyTemplate
    if (htmlTemplate !== undefined) updateData.htmlTemplate = htmlTemplate
    if (variables !== undefined) updateData.variables = variables
    if (isActive !== undefined) updateData.isActive = isActive

    const template = await prisma.notificationTemplate.update({
      where: { type },
      data: updateData,
    })

    return NextResponse.json({ template })
  } catch (error: any) {
    console.error('Error updating notification template:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to update template' },
      { status: 500 }
    )
  }
}

