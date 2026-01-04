import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { PenalizationDashboard } from '@/components/admin/penalization-dashboard'

export default async function PenalizationPage() {
  const session = await getServerSession(authOptions)

  if (!session || session.user.role !== 'ADMIN') {
    redirect('/auth/signin')
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-h1 mb-2">Ticket Penalization</h1>
        <p className="text-gray-600">Manage penalization status for resolved refund tickets</p>
      </div>
      <PenalizationDashboard />
    </div>
  )
}

