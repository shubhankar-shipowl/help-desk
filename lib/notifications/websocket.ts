import { Server as SocketIOServer } from 'socket.io'
import { Server as HTTPServer } from 'http'
import { subscribeToNotifications } from './pubsub'
import { prisma } from '../prisma'
import { getAppUrl } from '../utils'

/**
 * Retry a database operation with exponential backoff
 */
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

      // Only retry on connection errors
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

      // For non-connection errors, throw immediately
      throw error
    }
  }

  throw lastError
}

let io: SocketIOServer | null = null
let isInitialized = false

// Use Node.js global to store WebSocket instance across module boundaries
// This is necessary because Next.js API routes can have separate module instances
declare global {
  var __websocket_io__: SocketIOServer | null | undefined
  var __websocket_initialized__: boolean | undefined
}

// Initialize global if not exists
if (typeof global !== 'undefined') {
  if (!global.__websocket_io__) {
    global.__websocket_io__ = null
  }
  if (global.__websocket_initialized__ === undefined) {
    global.__websocket_initialized__ = false
  }
}

/**
 * Initialize WebSocket server
 */
export function initializeWebSocket(httpServer: HTTPServer) {
  const appUrl = getAppUrl()
  const nodeEnv = process.env.NODE_ENV || 'development'
  
  // In development, allow all origins. In production, allow the app URL and any origin
  // (more permissive for WebSocket connections through proxies)
  const corsOrigin = nodeEnv === 'development' 
    ? '*' // Allow all origins in development
    : '*' // Allow all origins in production too (needed for WebSocket through nginx proxy)
  
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: corsOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true, // Allow Engine.IO v3 clients
  })
  
  // Store in global for cross-module access (critical for Next.js)
  if (typeof global !== 'undefined') {
    global.__websocket_io__ = io
    global.__websocket_initialized__ = true
  }
  
  isInitialized = true

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      // Get token from handshake
      const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '')

      if (!token) {
        return next(new Error('Authentication token required'))
      }

      // Verify token - accept user ID directly for now
      // In production, verify JWT token properly
      const userId = token

      if (!userId) {
        return next(new Error('User ID required'))
      }

      // Get user from database with retry logic for transient connection issues
      const user = await withRetry(() =>
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, role: true, email: true, name: true },
        })
      )

      if (!user) {
        return next(new Error('User not found'))
      }

      socket.data.userId = user.id
      socket.data.role = user.role
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

    // Join user's personal room
    socket.join(`user:${userId}`)

    // Join role-based rooms
    if (role === 'AGENT' || role === 'ADMIN') {
      socket.join('agents')
      socket.join('admins')
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
            where: {
              id: notificationId,
              userId,
            },
            data: {
              read: true,
              readAt: new Date(),
            },
          })
        )

        // Update unread count
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
            where: {
              userId,
              read: false,
            },
            data: {
              read: true,
              readAt: new Date(),
            },
          })
        )

        socket.emit('notification:all-marked-read')
        socket.emit('notification:unread-count', 0)
      } catch (error) {
        console.error('Error marking all as read:', error)
        socket.emit('error', { message: 'Failed to mark all as read' })
      }
    })

    // Handle disconnect
    socket.on('disconnect', () => {
      // Connection closed
    })
  })

  // Subscribe to Redis notifications and emit to connected users
  subscribeToNotifications((notification) => {
    if (io) {
      // Emit to specific user
      io.to(`user:${notification.userId}`).emit('notification:new', notification)

      // Update unread count for that user
      withRetry(() =>
        prisma.notification.count({
          where: {
            userId: notification.userId,
            read: false,
          },
        })
      ).then(count => {
        io?.to(`user:${notification.userId}`).emit('notification:unread-count', count)
      }).catch(error => {
        console.error('[WebSocket] ❌ Error getting unread count:', error)
      })
    } else {
      console.error('[WebSocket] ❌ WebSocket server (io) is not initialized')
    }
  })

  return io
}

/**
 * Get WebSocket server instance
 * Returns null if not initialized yet
 */
export function getIO(): SocketIOServer | null {
  // Priority 1: Check global first (most reliable for Next.js)
  let instance: SocketIOServer | null = null
  
  if (typeof global !== 'undefined' && global.__websocket_io__) {
    instance = global.__websocket_io__
    // Sync module variable
    if (!io) {
      io = instance
      isInitialized = global.__websocket_initialized__ || false
    }
  } 
  // Priority 2: Use module variable if global not available
  else if (io) {
    instance = io
    // Sync to global
    if (typeof global !== 'undefined') {
      global.__websocket_io__ = instance
      global.__websocket_initialized__ = isInitialized
    }
  }
  
  if (!instance) {
    console.warn('[WebSocket] ⚠️ WebSocket server (io) is not initialized yet.')
    console.warn('[WebSocket] ⚠️ Make sure you are running: npm run dev (not next dev)')
  }
  
  return instance
}

/**
 * Emit notification to specific user
 */
export function emitToUser(userId: string, event: string, data: any) {
  const instance = getIO()
  if (instance) {
    instance.to(`user:${userId}`).emit(event, data)
  }
}

/**
 * Emit to all agents
 */
export function emitToAgents(event: string, data: any) {
  const instance = getIO()
  if (instance) {
    instance.to('agents').emit(event, data)
  }
}

/**
 * Emit to all admins
 */
export function emitToAdmins(event: string, data: any) {
  const instance = getIO()
  if (instance) {
    instance.to('admins').emit(event, data)
  }
}

