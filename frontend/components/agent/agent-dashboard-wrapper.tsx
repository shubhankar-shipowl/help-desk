'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { AgentPhoneConfig } from '@/components/settings/agent-phone-config'

interface AgentDashboardWrapperProps {
  children: React.ReactNode
  userPhone: string | null | undefined
  userId: string
}

export function AgentDashboardWrapper({ children, userPhone, userId }: AgentDashboardWrapperProps) {
  const { data: session } = useSession()
  const [showPhoneConfig, setShowPhoneConfig] = useState(false)

  useEffect(() => {
    // Only show for agents and admins, and only if phone is not configured
    if (session?.user && (session.user.role === 'AGENT' || session.user.role === 'ADMIN')) {
      if (!userPhone || userPhone.trim() === '') {
        setShowPhoneConfig(true)
      }
    }
  }, [session, userPhone])

  const handleClose = () => {
    // Allow closing - phone configuration is optional
    setShowPhoneConfig(false)
  }

  return (
    <>
      {children}
      <AgentPhoneConfig
        userPhone={userPhone}
        userId={userId}
        isOpen={showPhoneConfig}
        onClose={handleClose}
      />
    </>
  )
}

