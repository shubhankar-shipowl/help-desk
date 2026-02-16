'use client'

import { useSidebar } from './sidebar-context'
import { cn } from '@/lib/utils'

export function MainContent({ children }: { children: React.ReactNode }) {
  const { collapsed } = useSidebar()

  return (
    <main className={cn(
      'mt-16 transition-all duration-300',
      collapsed ? 'ml-0 md:ml-16' : 'ml-0 md:ml-60'
    )}>
      <div className="p-4 md:p-8">
        {children}
      </div>
    </main>
  )
}

