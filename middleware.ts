import { withAuth } from 'next-auth/middleware'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export default withAuth(
  function middleware(req) {
    const pathname = req.nextUrl.pathname
    const token = req.nextauth.token

    // Allow webpack hot-update files and other Next.js internal files
    if (pathname.startsWith('/_next/')) {
      return NextResponse.next()
    }

        // Public routes that don't require authentication
        if (
          pathname.startsWith('/api/auth/') ||
          pathname === '/auth/signin' ||
          pathname === '/' ||
          pathname.startsWith('/tickets/') || // Public ticket creation and viewing
          pathname === '/tickets/new' ||
          pathname === '/privacy' || // Privacy policy page (must be public)
          pathname.startsWith('/webhooks/') // Facebook webhook endpoint (must be public)
        ) {
          return NextResponse.next()
        }

    // If no token, let the page handle the redirect (to avoid double redirects)
    // This allows server-side session checks to work properly
    if (!token) {
      return NextResponse.next()
    }

    // Role-based access control (only if token exists)
    const role = (token as any).role

    // Admin routes that agents can also access
    const agentAccessibleAdminRoutes = ['/admin/call-logs']
    const isAgentAccessibleAdminRoute = agentAccessibleAdminRoutes.some(route => 
      pathname.startsWith(route)
    )

    // Admin routes - only ADMIN can access (except for agent-accessible routes)
    if (pathname.startsWith('/admin') && role !== 'ADMIN' && !isAgentAccessibleAdminRoute) {
      return NextResponse.redirect(new URL('/auth/signin', req.url))
    }

    // Agent-accessible admin routes - AGENT and ADMIN can access
    if (isAgentAccessibleAdminRoute && role !== 'AGENT' && role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/auth/signin', req.url))
    }

    // Agent routes - AGENT and ADMIN can access
    if (pathname.startsWith('/agent') && role !== 'AGENT' && role !== 'ADMIN') {
      return NextResponse.redirect(new URL('/auth/signin', req.url))
    }

    // Customer routes - CUSTOMER, ADMIN, and AGENT can all access
    // (No restriction needed here as all authenticated users can view customer pages)

    return NextResponse.next()
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const pathname = req.nextUrl.pathname
        
        // Always allow webpack hot-update files and Next.js internal files
        if (pathname.startsWith('/_next/')) {
          return true
        }
        
            // Allow public routes
            if (
              pathname.startsWith('/api/auth/') ||
              pathname === '/auth/signin' ||
              pathname === '/' ||
              pathname.startsWith('/tickets/') || // Public ticket creation and viewing
              pathname === '/tickets/new' ||
              pathname === '/privacy' || // Privacy policy page (must be public)
              pathname.startsWith('/webhooks/') // Facebook webhook endpoint (must be public)
            ) {
              return true
            }

        // For authenticated routes, check if token exists
        // If token exists, we'll do role-based checks in the middleware function
        // If token doesn't exist, allow through and let page components check session
        // This prevents double redirects when session exists but middleware token is stale
        return true
      },
    },
  }
)

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files, including webpack hot-update files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     * - api routes (handled separately)
     */
    '/((?!_next|api|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
