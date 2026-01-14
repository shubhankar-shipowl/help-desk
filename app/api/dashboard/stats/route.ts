import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { TicketStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'AGENT' && session.user.role !== 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const storeId = searchParams.get('storeId')
    
    // Get tenantId from session (multi-tenant support)
    const tenantId = (session.user as any).tenantId
    if (!tenantId) {
      return NextResponse.json(
        { error: 'Tenant ID is required' },
        { status: 400 }
      )
    }
    
    // Build base where clause
    const baseWhere: any = {
      tenantId, // Always filter by tenant
    }
    
    // For admins, storeId is required to filter data by store
    // If not provided, return empty/default stats instead of error to prevent UI breakage
    if (session.user.role === 'ADMIN') {
      if (!storeId) {
        // Return empty stats for admins without storeId selection
        return NextResponse.json({
          openTickets: 0,
          assignedTickets: 0,
          resolvedToday: 0,
          totalTickets: 0,
          urgentTickets: 0,
          averageResolutionTime: undefined,
          recentTickets: [],
          ticketVolumeData: [],
          categoryChartData: [],
        })
      }
      baseWhere.storeId = storeId
    } else if (storeId) {
      // For agents, storeId is optional
      baseWhere.storeId = storeId
    }

    // Add role-based filtering
    if (session.user.role === 'AGENT') {
      baseWhere.assignedAgentId = session.user.id
    }

    const [
      openTicketsResult,
      assignedTicketsResult,
      resolvedTodayResult,
      totalTicketsResult,
      urgentTicketsResult,
      resolvedTicketsForAvgResult,
    ] = await Promise.all([
      prisma.ticket.count({
        where: {
          ...baseWhere,
          status: { in: [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        },
      }),
      prisma.ticket.count({
        where: {
          ...baseWhere,
          assignedAgentId: session.user.id,
          status: { in: [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        },
      }),
      prisma.ticket.count({
        where: {
          ...baseWhere,
          assignedAgentId: session.user.id,
          status: TicketStatus.RESOLVED,
          resolvedAt: {
            gte: new Date(new Date().setHours(0, 0, 0, 0)),
          },
        },
      }),
      prisma.ticket.count({
        where: baseWhere,
      }),
      prisma.ticket.count({
        where: {
          ...baseWhere,
          priority: 'URGENT',
          status: { in: [TicketStatus.NEW, TicketStatus.OPEN, TicketStatus.IN_PROGRESS] },
        },
      }),
      prisma.ticket.findMany({
        where: {
          ...baseWhere,
          assignedAgentId: session.user.id,
          status: TicketStatus.RESOLVED,
          resolvedAt: { not: null },
        },
        select: {
          createdAt: true,
          resolvedAt: true,
        },
        take: 100, // Sample for average calculation
      }),
    ])

    // Calculate average resolution time in hours
    let averageResolutionTime: number | undefined = undefined
    if (resolvedTicketsForAvgResult.length > 0) {
      const totalHours = resolvedTicketsForAvgResult.reduce((sum, ticket) => {
        if (ticket.resolvedAt && ticket.createdAt) {
          const hours = (ticket.resolvedAt.getTime() - ticket.createdAt.getTime()) / (1000 * 60 * 60)
          return sum + hours
        }
        return sum
      }, 0)
      averageResolutionTime = totalHours / resolvedTicketsForAvgResult.length
    }

    // Get recent tickets
    const recentTickets = await prisma.ticket.findMany({
      where: baseWhere,
      include: {
        customer: {
          select: { name: true, email: true },
        },
        category: true,
        assignedAgent: {
          select: { name: true, email: true },
        },
        _count: {
          select: { comments: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    // Get ticket volume data for last 7 days
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const date = new Date()
      date.setDate(date.getDate() - (6 - i))
      return date.toISOString().split('T')[0]
    })

    const ticketVolumeData = await Promise.all(
      last7Days.map(async (date) => {
        try {
          const startOfDay = new Date(date)
          startOfDay.setHours(0, 0, 0, 0)
          const endOfDay = new Date(date)
          endOfDay.setHours(23, 59, 59, 999)

          const [created, resolved] = await Promise.all([
            prisma.ticket.count({
              where: {
                ...baseWhere,
                createdAt: { gte: startOfDay, lte: endOfDay },
              },
            }),
            prisma.ticket.count({
              where: {
                ...baseWhere,
                resolvedAt: { gte: startOfDay, lte: endOfDay },
              },
            }),
          ])

          return {
            date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            created,
            resolved,
          }
        } catch (error) {
          return {
            date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            created: 0,
            resolved: 0,
          }
        }
      })
    )

    // Get category distribution
    const categoryData = await prisma.ticket.groupBy({
      by: ['categoryId'],
      where: baseWhere,
      _count: true,
    })

    const categories = await prisma.category.findMany({
      where: { id: { in: categoryData.map((c) => c.categoryId).filter(Boolean) as string[] } },
    })

    const categoryChartData = categoryData.map((item) => {
      const category = categories.find((c) => c.id === item.categoryId)
      return {
        name: category?.name || 'Uncategorized',
        value: item._count,
        color: category?.color || '#3B82F6',
      }
    })

    return NextResponse.json({
      openTickets: openTicketsResult,
      assignedTickets: assignedTicketsResult,
      resolvedToday: resolvedTodayResult,
      totalTickets: totalTicketsResult,
      urgentTickets: urgentTicketsResult,
      averageResolutionTime,
      recentTickets,
      ticketVolumeData,
      categoryChartData,
    })
  } catch (error: any) {
    console.error('Error fetching dashboard stats:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to fetch dashboard stats' },
      { status: 500 }
    )
  }
}
