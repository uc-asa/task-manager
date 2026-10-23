import { MemoryCache, ReadThroughCache } from './cache.js';

/**
 * The application-wide read cache. This is the only place that chooses a cache store:
 * to share the cache between instances, pass a Redis-backed `Cache` here instead.
 */
export const readCache = new ReadThroughCache(new MemoryCache());

/** Key namespace for everything derived from the tasks collection. */
export const CacheKey = {
  stats: (today: string) => `tasks:stats:${today}`,
  allTasks: 'tasks:',
} as const;
