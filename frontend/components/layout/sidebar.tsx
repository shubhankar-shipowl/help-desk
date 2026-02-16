'use client'

import { usePathname } from 'next/navigation'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  Inbox,
  Ticket,
  Users,
  Settings,
  BarChart3,
  UserCog,
  Plug,
  ChevronLeft,
  ChevronRight,
  Phone,
  AlertTriangle,
  Store,
  Mail,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useSidebar } from './sidebar-context'

interface NavItem {
  label: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  badge?: number
  adminOnly?: boolean
  agentOnly?: boolean
}

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const { collapsed, setCollapsed } = useSidebar()

  const navItems: NavItem[] = [
    {
      label: 'Dashboard',
      href: '/agent/dashboard',
      icon: LayoutDashboard,
      agentOnly: true,
    },
    {
      label: 'Inbox',
      href: '/agent/tickets',
      icon: Inbox,
      agentOnly: true,
    },
    {
      label: 'My Tickets',
      href: '/customer/tickets',
      icon: Ticket,
      agentOnly: false,
      adminOnly: false,
    },
    {
      label: 'Customers',
      href: '/agent/customers',
      icon: Users,
      agentOnly: true,
    },
    {
      label: 'Call Logs',
      href: '/admin/call-logs',
      icon: Phone,
      agentOnly: false, // Both agents and admins can access
    },
    {
      label: 'Mail',
      href: '/agent/mail',
      icon: Mail,
      agentOnly: true, // Both agents and admins can access
    },
  ]

  const adminPenalizationItems: NavItem[] = [
    {
      label: 'Penalization',
      href: '/admin/penalization',
      icon: AlertTriangle,
      adminOnly: true,
    },
  ]

  const adminItems: NavItem[] = [
    {
      label: 'Settings',
      href: '/admin/settings',
      icon: Settings,
      adminOnly: true,
    },
    {
      label: 'Reports',
      href: '/admin/reports',
      icon: BarChart3,
      adminOnly: true,
    },
    {
      label: 'Users',
      href: '/admin/users',
      icon: UserCog,
      adminOnly: true,
    },
    {
      label: 'Stores',
      href: '/admin/stores',
      icon: Store,
      adminOnly: true,
    },
  ]

  const otherItems: NavItem[] = [
    {
      label: 'Integrations',
      href: '/admin/integrations',
      icon: Plug,
      adminOnly: true,
    },
  ]

  const filteredNavItems = navItems.filter((item) => {
    if (item.adminOnly && session?.user?.role !== 'ADMIN') return false
    if (item.agentOnly && session?.user?.role === 'CUSTOMER') return false
    return true
  })

  const filteredAdminItems = adminItems.filter(
    (item) => !item.adminOnly || session?.user?.role === 'ADMIN'
  )

  const filteredOtherItems = otherItems.filter(
    (item) => !item.adminOnly || session?.user?.role === 'ADMIN'
  )

  const filteredPenalizationItems = adminPenalizationItems.filter(
    (item) => !item.adminOnly || session?.user?.role === 'ADMIN'
  )

  const NavItemComponent = ({ item }: { item: NavItem }) => {
    const Icon = item.icon
    const isActive = pathname === item.href || pathname?.startsWith(item.href + '/')

    return (
      <Link href={item.href}>
        <div
          className={cn(
            'flex items-center h-11 rounded-lg transition-colors',
            collapsed ? 'justify-center px-0 mx-2' : 'gap-3 px-4 mx-3',
            isActive
              ? 'bg-primary/10 text-primary font-medium'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          )}
        >
          <Icon className={cn(
            collapsed ? 'h-6 w-6' : 'h-5 w-5',
            isActive ? 'text-primary' : 'text-gray-400'
          )} />
          {!collapsed && (
            <>
              <span className="flex-1 text-sm">{item.label}</span>
              {item.badge !== undefined && (
                <span
                  className={cn(
                    'px-2 py-0.5 rounded-full text-xs font-medium',
                    isActive ? 'bg-primary text-white' : 'bg-gray-200 text-gray-700'
                  )}
                >
                  {item.badge}
                </span>
              )}
            </>
          )}
        </div>
      </Link>
    )
  }

  return (
    <aside
      className={cn(
        'fixed left-0 top-16 bottom-0 bg-white border-r border-gray-200 transition-all duration-300 z-40',
        'hidden md:flex flex-col', // Hide on mobile, show on desktop
        collapsed ? 'w-16' : 'w-60'
      )}
    >
      <nav className="h-full flex flex-col py-4">
        <div className="flex-1 space-y-1">
          {filteredNavItems.map((item) => (
            <NavItemComponent key={item.href} item={item} />
          ))}

          {(filteredAdminItems.length > 0 || filteredOtherItems.length > 0 || filteredPenalizationItems.length > 0) && (
            <>
              <div className={cn('h-px bg-gray-200 my-3', collapsed ? 'mx-2' : 'mx-3')} />
              {filteredAdminItems.map((item) => (
                <NavItemComponent key={item.href} item={item} />
              ))}
              {filteredPenalizationItems.length > 0 && (
                <>
                  {filteredPenalizationItems.map((item) => (
                    <NavItemComponent key={item.href} item={item} />
                  ))}
                </>
              )}
              {filteredOtherItems.length > 0 && (
                <>
                  <div className={cn('h-px bg-gray-200 my-3', collapsed ? 'mx-2' : 'mx-3')} />
                  {filteredOtherItems.map((item) => (
                    <NavItemComponent key={item.href} item={item} />
                  ))}
                </>
              )}
            </>
          )}
        </div>

        {/* Collapse Button */}
        <div className="px-3 pt-4 border-t border-gray-200">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className="w-full h-10"
          >
            {collapsed ? (
              <ChevronRight className="h-5 w-5" />
            ) : (
              <ChevronLeft className="h-5 w-5" />
            )}
          </Button>
        </div>
      </nav>
    </aside>
  )
}

