/**
 * WebSocket event emission proxy for microservice architecture.
 *
 * In the monolith, Socket.IO ran inside the Next.js process.
 * Now Socket.IO runs in the notification-service (port 4004).
 * These functions call the notification-service's /internal/emit-event
 * endpoint to emit WebSocket events to connected clients.
 */

const NOTIFICATION_SERVICE_URL = process.env.NOTIFICATION_SERVICE_URL || 'http://localhost:4004'
const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || ''

async function emitEvent(event: string, data: any, rooms: string[]): Promise<void> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${NOTIFICATION_SERVICE_URL}/internal/emit-event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-api-key': INTERNAL_API_KEY,
      },
      body: JSON.stringify({ event, data, rooms }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      console.error(`[WebSocket Proxy] emit-event failed (status ${response.status}):`, error)
    }
  } catch (error: any) {
    if (error.name === 'AbortError') {
      console.error('[WebSocket Proxy] emit-event timed out')
    } else {
      console.error('[WebSocket Proxy] emit-event error:', error.message)
    }
  }
}

/**
 * Emit notification to specific user
 */
export function emitToUser(userId: string, event: string, data: any) {
  emitEvent(event, data, [`user:${userId}`]).catch(() => {})
}

/**
 * Emit to all agents
 */
export function emitToAgents(event: string, data: any) {
  emitEvent(event, data, ['agents']).catch(() => {})
}

/**
 * Emit to all admins
 */
export function emitToAdmins(event: string, data: any) {
  emitEvent(event, data, ['admins']).catch(() => {})
}

/**
 * @deprecated Socket.IO server now runs in notification-service.
 * This function exists only for backward compatibility with code that checks for getIO().
 * It always returns null.
 */
export function getIO(): null {
  return null
}

/**
 * @deprecated Socket.IO server now runs in notification-service.
 * This function is a no-op for backward compatibility.
 */
export function initializeWebSocket(): null {
  return null
}
