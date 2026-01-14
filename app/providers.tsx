'use client'

import { SessionProvider } from 'next-auth/react'
import { Toaster } from '@/components/ui/toaster'
import { StoreProvider } from '@/lib/store-context'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <StoreProvider>
        {children}
        <Toaster />
      </StoreProvider>
    </SessionProvider>
  )
}

