import { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import { PrismaAdapter } from '@auth/prisma-adapter'
import { prisma } from './prisma'
import bcrypt from 'bcryptjs'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma) as any,
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null
        }

        // Since email is no longer unique (tenantId_email is the unique constraint),
        // we need to find the user by email first, then verify tenant
        // In a multi-tenant system, we might need to determine tenant from domain/subdomain
        // For now, we'll find the first user with this email (assuming one tenant per email)
        const user = await prisma.user.findFirst({
          where: { email: credentials.email },
          include: { tenant: true }, // Include tenant for multi-tenant support
        })

        // Only users with passwords can login (admins and agents)
        // Customers don't have passwords and cannot login
        if (!user || !user.password) {
          return null
        }

        // Only ADMIN and AGENT roles can login
        // CUSTOMER role cannot login (they can only create tickets)
        if (user.role === 'CUSTOMER') {
          return null
        }

        const isPasswordValid = await bcrypt.compare(
          credentials.password,
          user.password
        )

        if (!isPasswordValid) {
          return null
        }

        if (!user.isActive) {
          return null
        }

        // Check if tenant is active
        if (!user.tenant?.isActive) {
          return null
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          avatar: user.avatar,
          tenantId: user.tenantId, // Include tenantId for multi-tenant support
        }
      },
    }),
  ],
  session: {
    strategy: 'jwt',
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.email = user.email
        token.name = user.name
        token.role = (user as any).role
        token.avatar = (user as any).avatar
        token.tenantId = (user as any).tenantId // Include tenantId for multi-tenant support
      }
      return token
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string
        session.user.email = token.email as string
        session.user.name = token.name as string
        session.user.role = token.role as string
        session.user.avatar = token.avatar as string
        ;(session.user as any).tenantId = token.tenantId as string // Include tenantId for multi-tenant support
      }
      return session
    },
  },
  pages: {
    signIn: '/auth/signin',
  },
  secret: process.env.NEXTAUTH_SECRET,
}

