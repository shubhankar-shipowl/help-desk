import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

export default async function Home() {
  const session = await getServerSession(authOptions)

  // If logged in, redirect to appropriate dashboard
  if (session) {
    if (session.user.role === 'CUSTOMER') {
      redirect('/customer/tickets')
    }
    if (session.user.role === 'AGENT' || session.user.role === 'ADMIN') {
      redirect('/agent/dashboard')
    }
  }

  // Redirect to login page for non-authenticated users
  redirect('/auth/signin')
}

