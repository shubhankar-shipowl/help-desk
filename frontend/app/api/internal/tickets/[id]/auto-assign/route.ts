import { NextRequest, NextResponse } from 'next/server'
import { autoAssignTicket } from '@/lib/automation'

export const dynamic = 'force-dynamic'

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const apiKey = req.headers.get('x-internal-api-key')
  if (!INTERNAL_API_KEY || apiKey !== INTERNAL_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await autoAssignTicket(params.id)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('[Internal API] Auto-assign error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
