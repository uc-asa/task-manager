/**
 * The caching contract the application depends on. The default implementation is in-memory;
 * with several API instances you would implement `Cache` on top of Redis (or Valkey/Memcached)
 * and change one line in `cache/index.ts`. Nothing else knows which store is in use.
 */
export interface Cache {
  get<T>(key: string): Promise<T | undefined>;
  /** `ttlMs <= 0` means "do not store". */
  set<T>(key: string, value: T, ttlMs: number): Promise<void>;
  delete(key: string): Promise<void>;
  /** Removes every key that starts with `prefix`. An empty prefix clears everything. */
  deleteByPrefix(prefix: string): Promise<void>;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

/** A small in-process cache with per-key TTL and a size cap (oldest entries are evicted first). */
export class MemoryCache implements Cache {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxEntries = 500,
    /** Injectable clock, so TTL behaviour can be tested without waiting. */
    private readonly now: () => number = Date.now,
  ) {}

  get<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return Promise.resolve(undefined);
    }
    return Promise.resolve(entry.value as T);
  }

  set<T>(key: string, value: T, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) return Promise.resolve();
    this.entries.delete(key); // re-insert so the key becomes the newest entry
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  deleteByPrefix(prefix: string): Promise<void> {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
    return Promise.resolve();
  }
}

/**
 * Cache-aside with two protections a plain `get`/`set` lacks:
 *
 *  - single flight: concurrent misses for one key share a single load (no stampede on the database)
 *  - invalidation safety: if the data is invalidated while a load is running, that load's result
 *    is NOT stored, otherwise a slow read that began before a write would put stale data back
 */
export class ReadThroughCache {
  private readonly inflight = new Map<string, Promise<unknown>>();
  private generation = 0;

  constructor(private readonly cache: Cache) {}

  async getOrLoad<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    if (ttlMs <= 0) return load();

    // Read the generation before ANY await: an invalidation at any later point (including while
    // we wait on the cache itself) must stop this result from being stored.
    const startedAt = this.generation;

    const hit = await this.cache.get<T>(key);
    if (hit !== undefined) return hit;

    const running = this.inflight.get(key);
    if (running) return running as Promise<T>;

    const pending = load()
      .then(async (value) => {
        if (this.generation === startedAt) await this.cache.set(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        // A newer load may have replaced this entry after an invalidation; only remove our own.
        if (this.inflight.get(key) === pending) this.inflight.delete(key);
      });
    this.inflight.set(key, pending);
    return pending;
  }

  /** Call after writes that change what the cached values were derived from. */
  async invalidate(prefix: string): Promise<void> {
    this.generation += 1;
    this.inflight.clear(); // readers after this point must not join a load of pre-write data
    await this.cache.deleteByPrefix(prefix);
  }
}
