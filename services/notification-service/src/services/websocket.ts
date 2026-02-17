import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import { subscribeToNotifications } from './pubsub'
import { prisma } from '../config/database'

async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelayMs: number = 500
): Promise<T> {
  let lastError: Error | null = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error) {
      lastError = error as Error
      const errorMessage = (error as Error).message || ''

      if (
        errorMessage.includes("Can't reach database server") ||
        errorMessage.includes('Connection refused') ||
        errorMessage.includes('ECONNRESET') ||
        errorMessage.includes('ETIMEDOUT')
      ) {
        if (attempt < maxRetries - 1) {
          const delay = baseDelayMs * Math.pow(2, attempt)
          console.warn(`[WebSocket] Database connection failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`)
          await new Promise(resolve => setTimeout(resolve, delay))
          continue
        }
      }

      throw error
    }
  }

  throw lastError
}

let io: SocketIOServer | null = null

export function initializeWebSocket(httpServer: HTTPServer) {
  // Allow connections from the frontend (APP_URL) and localhost in development
  const allowedOrigins: string[] = []
  const appUrl = process.env.APP_URL
  if (appUrl) allowedOrigins.push(appUrl)
  if (process.env.NODE_ENV !== 'production') {
    allowedOrigins.push('http://localhost:4002', 'http://127.0.0.1:4002')
  }

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: allowedOrigins.length > 0 ? allowedOrigins : '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true,
  })

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        return next(new Error('Authentication token required'))
      }

      const userId = token

      if (!userId) {
        return next(new Error('User ID required'))
      }

      const user = await withRetry(() =>
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true, email: true, name: true },
        })
      )

      if (!user) {
        return next(new Error('User not found'))
      }

      socket.data.userId = (user as any).id
      socket.data.role = (user as any).role
      socket.data.user = user

      next()
    } catch (error) {
      console.error('WebSocket authentication error:', error)
      next(new Error('Authentication failed'))
    }
  })

  // Connection handling
  io.on('connection', (socket) => {
    const userId = socket.data.userId
    const role = socket.data.role

    socket.join(`user:${userId}`)

    if (role === 'AGENT' || role === 'ADMIN') {
      socket.join('agents')
    }

    if (role === 'ADMIN') {
      socket.join('admins')
    }

    // Send current unread count on connection
    withRetry(() =>
      prisma.notification.count({
        where: { userId, read: false },
      })
    ).then(count => {
      socket.emit('notification:unread-count', count)
    }).catch(error => {
      console.error(`[WebSocket] Error getting unread count for user ${userId}:`, error)
    })

    // Handle mark as read
    socket.on('notification:read', async (notificationId: string) => {
      try {
        await withRetry(() =>
          prisma.notification.updateMany({
            where: { id: notificationId, userId },
            data: { read: true, readAt: new Date() },
          })
        )

        const count = await withRetry(() =>
          prisma.notification.count({
            where: { userId, read: false },
          })
        )

        socket.emit('notification:marked-read', notificationId)
        socket.emit('notification:unread-count', count)
      } catch (error) {
        console.error('Error marking notification as read:', error)
        socket.emit('error', { message: 'Failed to mark notification as read' })
      }
    })

    // Handle mark all as read
    socket.on('notification:mark-all-read', async () => {
      try {
        await withRetry(() =>
          prisma.notification.updateMany({
            where: { userId, read: false },
            data: { read: true, readAt: new Date() },
          })
        )

        socket.emit('notification:all-marked-read')
        socket.emit('notification:unread-count', 0)
      } catch (error) {
        console.error('Error marking all as read:', error)
        socket.emit('error', { message: 'Failed to mark all as read' })
      }
    })

    socket.on('disconnect', () => {
      // Connection closed
    })
  })

  // Subscribe to Redis notifications and emit to connected users
  subscribeToNotifications((notification) => {
    if (io) {
      io.to(`user:${notification.userId}`).emit('notification:new', notification)

      withRetry(() =>
        prisma.notification.count({
          where: { userId: notification.userId, read: false },
        })
      ).then(count => {
        io?.to(`user:${notification.userId}`).emit('notification:unread-count', count)
      }).catch(error => {
        console.error('[WebSocket] Error getting unread count:', error)
      })
    }
  })

  console.log('[WebSocket] Socket.IO server initialized')
  return io
}

export function getIO(): SocketIOServer | null {
  return io
}

export function emitToUser(userId: string, event: string, data: any) {
  if (io) {
    io.to(`user:${userId}`).emit(event, data)
  }
}

export function emitToAgents(event: string, data: any) {
  if (io) {
    io.to('agents').emit(event, data)
  }
}

export function emitToAdmins(event: string, data: any) {
  if (io) {
    io.to('admins').emit(event, data)
  }
}
