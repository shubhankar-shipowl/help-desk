import { prisma } from '../config/database';

const settingsCache: Map<string, string> = new Map();

function getCacheKey(tenantId: string, storeId: string | null, key: string): string {
  return `${tenantId}:${storeId || 'null'}:${key}`;
}

export async function getSystemSetting(
  key: string,
  tenantId: string,
  storeId?: string | null
): Promise<string | null> {
  if (!tenantId) {
    return null;
  }

  if (storeId) {
    const storeCacheKey = getCacheKey(tenantId, storeId, key);

    if (settingsCache.has(storeCacheKey)) {
      return settingsCache.get(storeCacheKey) || null;
    }

    const storeSetting = await prisma.systemSettings.findFirst({
      where: { tenantId, storeId, key },
    });

    if (storeSetting) {
      settingsCache.set(storeCacheKey, storeSetting.value);
      return storeSetting.value;
    }
  }

  const tenantCacheKey = getCacheKey(tenantId, null, key);

  if (settingsCache.has(tenantCacheKey)) {
    return settingsCache.get(tenantCacheKey) || null;
  }

  const tenantSetting = await prisma.systemSettings.findFirst({
    where: { tenantId, storeId: null, key },
  });

  if (tenantSetting) {
    settingsCache.set(tenantCacheKey, tenantSetting.value);
    return tenantSetting.value;
  }

  return null;
}

export function clearSystemSettingsCache(tenantId?: string, storeId?: string | null) {
  if (tenantId && storeId !== undefined) {
    const prefix = `${tenantId}:${storeId || 'null'}:`;
    for (const key of settingsCache.keys()) {
      if (key.startsWith(prefix)) {
        settingsCache.delete(key);
      }
    }
  } else if (tenantId) {
    const prefix = `${tenantId}:`;
    for (const key of settingsCache.keys()) {
      if (key.startsWith(prefix)) {
        settingsCache.delete(key);
      }
    }
  } else {
    settingsCache.clear();
  }
}
