import NextAuth from 'next-auth'
import { authOptions } from '@/lib/auth'

// Force dynamic rendering - NextAuth should never be statically generated
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Defer handler creation to request time to avoid build-time failures
// when environment variables (NEXTAUTH_SECRET, DATABASE_URL) are not available
export async function GET(...args: any[]) {
  const handler = NextAuth(authOptions)
  return handler(...args)
}

export async function POST(...args: any[]) {
  const handler = NextAuth(authOptions)
  return handler(...args)
}
