import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { NotificationPreferences } from '@/components/notifications/notification-preferences'

export default async function NotificationSettingsPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/auth/signin')
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-h1 mb-2">Notification Preferences</h1>
        <p className="text-gray-600">Manage how you receive notifications</p>
      </div>
      <NotificationPreferences />
    </div>
  )
}

