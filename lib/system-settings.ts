import { prisma } from './prisma'

// Simple in-memory cache for system settings
const settingsCache: Map<string, Map<string, string>> = new Map()

export async function getSystemSetting(key: string, tenantId: string): Promise<string | null> {
  if (!tenantId) {
    console.warn(`[SystemSettings] Attempted to get setting '${key}' without tenantId. Falling back to null.`)
    return null
  }

  // Check cache first
  if (settingsCache.has(tenantId) && settingsCache.get(tenantId)?.has(key)) {
    return settingsCache.get(tenantId)?.get(key) || null
  }

  // Fetch from database
  const setting = await prisma.systemSettings.findUnique({
    where: {
      tenantId_key: {
        tenantId,
        key,
      },
    },
  })

  if (setting) {
    // Store in cache
    if (!settingsCache.has(tenantId)) {
      settingsCache.set(tenantId, new Map())
    }
    settingsCache.get(tenantId)?.set(key, setting.value)
    return setting.value
  }

  return null
}

export function clearSystemSettingsCache(tenantId?: string) {
  if (tenantId) {
    settingsCache.delete(tenantId)
    console.log(`[SystemSettings] Cleared cache for tenant: ${tenantId}`)
  } else {
    settingsCache.clear()
    console.log('[SystemSettings] Cleared all system settings cache.')
  }
}

