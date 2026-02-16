// Force dynamic rendering - NextAuth should never be statically generated
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Use dynamic imports to defer loading of next-auth and auth config to request time.
// This prevents build-time failures when database or env vars are unavailable.
export async function GET(...args: any[]) {
  const NextAuth = (await import('next-auth')).default
  const { authOptions } = await import('@/lib/auth')
  const handler = NextAuth(authOptions)
  return handler(...args)
}

export async function POST(...args: any[]) {
  const NextAuth = (await import('next-auth')).default
  const { authOptions } = await import('@/lib/auth')
  const handler = NextAuth(authOptions)
  return handler(...args)
}
