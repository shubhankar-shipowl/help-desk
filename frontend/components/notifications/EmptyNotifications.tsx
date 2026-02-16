import { Bell, Inbox, AtSign, Settings } from 'lucide-react'

interface EmptyNotificationsProps {
  filter: string
}

export function EmptyNotifications({ filter }: EmptyNotificationsProps) {
  const messages: Record<string, { icon: any; title: string; description: string }> = {
    all: {
      icon: Bell,
      title: "You're all caught up!",
      description: "No new notifications at the moment. We'll let you know when something needs your attention.",
    },
    tickets: {
      icon: Inbox,
      title: 'No ticket notifications',
      description: 'You have no notifications related to tickets right now.',
    },
    mentions: {
      icon: AtSign,
      title: 'No mentions',
      description: "You haven't been mentioned in any tickets or comments recently.",
    },
    system: {
      icon: Settings,
      title: 'No system notifications',
      description: 'All systems are running smoothly. No alerts or updates.',
    },
  }

  const { icon: Icon, title, description } = messages[filter] || messages.all

  return (
    <div className="flex flex-col items-center justify-center py-16 px-8">
      <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
        <Icon className="w-10 h-10 text-gray-400" />
      </div>
      <h3 className="text-lg font-semibold text-gray-900 mb-2 text-center">
        {title}
      </h3>
      <p className="text-sm text-gray-500 text-center max-w-xs">
        {description}
      </p>
    </div>
  )
}

