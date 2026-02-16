import { prisma } from './prisma'

// Simple in-memory cache for system settings
// Cache key format: "tenantId:storeId:key" or "tenantId:null:key" for tenant-level settings
const settingsCache: Map<string, string> = new Map()

function getCacheKey(tenantId: string, storeId: string | null, key: string): string {
  return `${tenantId}:${storeId || 'null'}:${key}`
}

export async function getSystemSetting(
  key: string, 
  tenantId: string, 
  storeId?: string | null
): Promise<string | null> {
  if (!tenantId) {
    console.warn(`[SystemSettings] Attempted to get setting '${key}' without tenantId. Falling back to null.`)
    return null
  }

  // Try store-specific setting first if storeId is provided
  if (storeId) {
    const storeCacheKey = getCacheKey(tenantId, storeId, key)
    
    // Check cache first
    if (settingsCache.has(storeCacheKey)) {
      return settingsCache.get(storeCacheKey) || null
    }

    // Fetch from database
    const storeSetting = await prisma.systemSettings.findFirst({
      where: {
        tenantId,
        storeId,
        key,
      },
    })

    if (storeSetting) {
      // Store in cache
      settingsCache.set(storeCacheKey, storeSetting.value)
      return storeSetting.value
    }
  }

  // Fallback to tenant-level setting (storeId = null)
  const tenantCacheKey = getCacheKey(tenantId, null, key)
  
  // Check cache
  if (settingsCache.has(tenantCacheKey)) {
    return settingsCache.get(tenantCacheKey) || null
  }

  // Fetch from database
  const tenantSetting = await prisma.systemSettings.findFirst({
    where: {
      tenantId,
      storeId: null,
      key,
    },
  })

  if (tenantSetting) {
    // Store in cache
    settingsCache.set(tenantCacheKey, tenantSetting.value)
    return tenantSetting.value
  }

  return null
}

export function clearSystemSettingsCache(tenantId?: string, storeId?: string | null) {
  if (tenantId && storeId !== undefined) {
    // Clear specific store cache
    const prefix = `${tenantId}:${storeId || 'null'}:`
    for (const key of settingsCache.keys()) {
      if (key.startsWith(prefix)) {
        settingsCache.delete(key)
      }
    }
    console.log(`[SystemSettings] Cleared cache for tenant: ${tenantId}, store: ${storeId || 'tenant-level'}`)
  } else if (tenantId) {
    // Clear all settings for a tenant
    const prefix = `${tenantId}:`
    for (const key of settingsCache.keys()) {
      if (key.startsWith(prefix)) {
        settingsCache.delete(key)
      }
    }
    console.log(`[SystemSettings] Cleared cache for tenant: ${tenantId}`)
  } else {
    // Clear all cache
    settingsCache.clear()
    console.log('[SystemSettings] Cleared all system settings cache.')
  }
}

