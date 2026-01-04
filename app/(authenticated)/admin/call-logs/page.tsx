import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { CallLogsClient } from '@/components/admin/call-logs-client'

export default async function CallLogsPage() {
  const session = await getServerSession(authOptions)

  if (!session || (session.user.role !== 'ADMIN' && session.user.role !== 'AGENT')) {
    redirect('/auth/signin')
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-h1 mb-2">Call Logs</h1>
        <p className="text-gray-600">View and manage call history</p>
      </div>
      <CallLogsClient />
    </div>
  )
}

