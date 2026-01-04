import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const groupBy = searchParams.get('groupBy') || 'day' // day, week, month

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

    if (startDate) {
      const start = new Date(startDate)
      start.setHours(0, 0, 0, 0)
      where.createdAt = { ...where.createdAt, gte: start }
    }

    if (endDate) {
      const end = new Date(endDate)
      end.setHours(23, 59, 59, 999)
      where.createdAt = { ...where.createdAt, lte: end }
    }

    if (session.user.role === 'AGENT') {
      where.assignedAgentId = session.user.id
    }

    // Get ticket volume by date
    const tickets = await prisma.ticket.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        status: true,
        priority: true,
        resolvedAt: true,
        categoryId: true,
      },
      orderBy: { createdAt: 'asc' },
    })

    // Group tickets by date
    const groupedData: Record<string, any> = {}
    
    tickets.forEach((ticket) => {
      const date = new Date(ticket.createdAt)
      let key: string
      let displayDate: string

      if (groupBy === 'day') {
        key = date.toISOString().split('T')[0]
        displayDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      } else if (groupBy === 'week') {
        const weekStart = new Date(date)
        weekStart.setDate(date.getDate() - date.getDay())
        key = weekStart.toISOString().split('T')[0]
        const weekEnd = new Date(weekStart)
        weekEnd.setDate(weekStart.getDate() + 6)
        displayDate = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      } else {
        key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
        displayDate = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
      }

      if (!groupedData[key]) {
        groupedData[key] = {
          date: key,
          displayDate: displayDate,
          total: 0,
          resolved: 0,
          byStatus: {},
          byPriority: {},
        }
      }

      groupedData[key].total++
      if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') {
        groupedData[key].resolved++
      }
      groupedData[key].byStatus[ticket.status] =
        (groupedData[key].byStatus[ticket.status] || 0) + 1
      groupedData[key].byPriority[ticket.priority] =
        (groupedData[key].byPriority[ticket.priority] || 0) + 1
    })

    // Sort reportData by date
    const reportData = Object.values(groupedData).sort((a: any, b: any) => 
      a.date.localeCompare(b.date)
    )

    // Calculate average resolution time
    const resolvedTickets = tickets.filter((t) => t.resolvedAt)
    let avgResolutionTime = 0
    if (resolvedTickets.length > 0) {
      const totalTime = resolvedTickets.reduce((sum, ticket) => {
        if (ticket.resolvedAt) {
          return (
            sum +
            (new Date(ticket.resolvedAt).getTime() -
              new Date(ticket.createdAt).getTime())
          )
        }
        return sum
      }, 0)
      avgResolutionTime = totalTime / resolvedTickets.length / (1000 * 60 * 60) // Convert to hours
    }

    const response = {
      reportData,
      summary: {
        totalTickets: tickets.length,
        resolvedTickets: resolvedTickets.length,
        averageResolutionTime: avgResolutionTime.toFixed(2),
      },
    }
    
    console.log(`[Reports API] Generated report: ${tickets.length} tickets, ${reportData.length} groups`)
    
    return NextResponse.json(response)
  } catch (error: any) {
    console.error('Error generating report:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to generate report' },
      { status: 500 }
    )
  }
}

