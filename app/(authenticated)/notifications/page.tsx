import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { NotificationList } from '@/components/notifications/NotificationList'

export default async function NotificationsPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/auth/signin')
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-h1 mb-2">Notifications</h1>
        <p className="text-gray-600">View and manage all your notifications</p>
      </div>
      <NotificationList />
    </div>
  )
}

