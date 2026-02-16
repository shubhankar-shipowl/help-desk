import 'next-auth'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      name?: string | null
      role: string
      avatar?: string | null
      tenantId?: string // Multi-tenant support
    }
  }

  interface User {
    id: string
    email: string
    name?: string | null
    role: string
    avatar?: string | null
    tenantId?: string // Multi-tenant support
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    email?: string
    name?: string | null
    role: string
    avatar?: string | null
    tenantId?: string // Multi-tenant support
  }
}

