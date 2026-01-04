import { NextResponse } from 'next/server'

// This route handles Chrome DevTools requests
// Chrome automatically requests this file when DevTools is open
// Returning an empty response prevents 404 errors in logs
export async function GET() {
  return NextResponse.json({}, { status: 200 })
}

