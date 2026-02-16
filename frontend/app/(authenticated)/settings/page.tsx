import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { NotificationPreferences } from '@/components/notifications/notification-preferences'

export default async function SettingsPage() {
  const session = await getServerSession(authOptions)

  if (!session) {
    redirect('/auth/signin')
  }

  // Redirect admins to admin settings
  if (session.user.role === 'ADMIN') {
    redirect('/admin/settings')
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Settings</h1>
        <p className="text-gray-600">Manage your preferences</p>
      </div>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold mb-4">Notification Preferences</h2>
          <NotificationPreferences />
        </div>
      </div>
    </div>
  )
}

