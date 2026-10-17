/**
 * Lightweight, safe in-memory cache for high-frequency static test data.
 * Drastically reduces Firestore reads when thousands of concurrent students
 * access identical tests, series, question sheets, and answer keys.
 */

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const memoryStore = new Map<string, CacheEntry<any>>();

export async function getOrSetCache<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const now = Date.now();
  const cached = memoryStore.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.data as T;
  }

  const freshData = await fetcher();
  memoryStore.set(key, {
    data: freshData,
    expiresAt: now + ttlMs,
  });

  return freshData;
}

/**
 * Invalidate a specific cache key (useful on admin edits or question uploads)
 */
export function invalidateCache(key: string): void {
  memoryStore.delete(key);
}

/**
 * Invalidate all keys matching a prefix
 */
export function invalidateCachePrefix(prefix: string): void {
  for (const key of memoryStore.keys()) {
    if (key.startsWith(prefix)) {
      memoryStore.delete(key);
    }
  }
}
