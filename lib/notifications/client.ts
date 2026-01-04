'use client'

import { io, Socket } from 'socket.io-client'
import { useSession } from 'next-auth/react'
import { useEffect, useRef } from 'react'

let socket: Socket | null = null

export function useNotificationSocket() {
  const { data: session } = useSession()
  const socketRef = useRef<Socket | null>(null)

  useEffect(() => {
    if (!session?.user?.id) return

    // Use user ID as token for WebSocket authentication
    const token = session.user.id

    // Connect to WebSocket server
    const wsUrl = process.env.NEXT_PUBLIC_WS_URL || window.location.origin
    socketRef.current = io(wsUrl, {
      auth: { token },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
      path: '/socket.io/',
    })

    socket = socketRef.current

    socketRef.current.on('connect_error', (error) => {
      console.error('[WebSocket Client] ❌ Connection error:', error)
    })

    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
        socketRef.current = null
        socket = null
      }
    }
  }, [session])

  return socketRef.current
}

export function connectNotificationSocket(token: string): Socket {
  if (socket && socket.connected) {
    return socket
  }

  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || window.location.origin
  socket = io(wsUrl, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnection: true,
  })

  return socket
}

export function disconnectNotificationSocket() {
  if (socket) {
    socket.disconnect()
    socket = null
  }
}

export function getNotificationSocket(): Socket | null {
  return socket
}

