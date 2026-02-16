import { getServerSession } from 'next-auth'
import { authOptions } from './auth'

/**
 * Get the current user's tenant ID from session
 * @returns Tenant ID or null if not authenticated
 */
export async function getTenantId(): Promise<string | null> {
  try {
    const session = await getServerSession(authOptions)
    return (session?.user as any)?.tenantId || null
  } catch (error) {
    console.error('[getTenantId] Error:', error)
    return null
  }
}

/**
 * Require tenant ID - throws error if not found
 * Use this in API routes that require authentication
 * @returns Tenant ID (never null)
 * @throws Error if tenant ID is not found
 */
export async function requireTenantId(): Promise<string> {
  const tenantId = await getTenantId()
  if (!tenantId) {
    throw new Error('Tenant ID is required. User must be authenticated.')
  }
  return tenantId
}

/**
 * Get tenant context for a user
 * Useful for getting tenant information
 */
export async function getTenantContext() {
  const tenantId = await getTenantId()
  if (!tenantId) {
    return null
  }

  const { prisma } = await import('./prisma')
  return await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: {
      id: true,
      name: true,
      slug: true,
      domain: true,
      isActive: true,
      settings: true,
    },
  })
}

