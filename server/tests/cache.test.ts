import { describe, expect, it, vi } from 'vitest';
import { MemoryCache, ReadThroughCache } from '../src/cache/cache.js';

/** A promise controlled from the test, to hold a load "in flight" while other things happen. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('MemoryCache', () => {
  it('returns what was stored until the TTL passes', async () => {
    let now = 1_000;
    const cache = new MemoryCache(10, () => now);

    await cache.set('a', 'value', 100);
    expect(await cache.get('a')).toBe('value');
    now += 99;
    expect(await cache.get('a')).toBe('value');
    now += 1;
    expect(await cache.get('a')).toBeUndefined();
  });

  it('does not store anything when the TTL is zero (caching switched off)', async () => {
    const cache = new MemoryCache();
    await cache.set('a', 1, 0);
    expect(await cache.get('a')).toBeUndefined();
  });

  it('deletes by key and by prefix', async () => {
    const cache = new MemoryCache();
    await cache.set('tasks:stats:1', 1, 1000);
    await cache.set('tasks:stats:2', 2, 1000);
    await cache.set('other', 3, 1000);

    await cache.delete('tasks:stats:1');
    expect(await cache.get('tasks:stats:1')).toBeUndefined();

    await cache.deleteByPrefix('tasks:');
    expect(await cache.get('tasks:stats:2')).toBeUndefined();
    expect(await cache.get('other')).toBe(3);
  });

  it('is bounded: the oldest entries are evicted first', async () => {
    const cache = new MemoryCache(2);
    await cache.set('a', 1, 1000);
    await cache.set('b', 2, 1000);
    await cache.set('c', 3, 1000);

    expect(await cache.get('a')).toBeUndefined();
    expect(await cache.get('b')).toBe(2);
    expect(await cache.get('c')).toBe(3);
  });
});

describe('ReadThroughCache', () => {
  const make = () => new ReadThroughCache(new MemoryCache());

  it('loads once and serves later reads from the cache', async () => {
    const reads = make();
    const load = vi.fn(() => Promise.resolve('fresh'));

    expect(await reads.getOrLoad('k', 1000, load)).toBe('fresh');
    expect(await reads.getOrLoad('k', 1000, load)).toBe('fresh');
    expect(load).toHaveBeenCalledOnce();
  });

  it('shares one load between concurrent misses (no stampede on the database)', async () => {
    const reads = make();
    const gate = deferred<string>();
    const load = vi.fn(() => gate.promise);

    const results = Promise.all(Array.from({ length: 8 }, () => reads.getOrLoad('k', 1000, load)));
    gate.resolve('shared');

    expect(await results).toEqual(Array(8).fill('shared'));
    expect(load).toHaveBeenCalledOnce();
  });

  it('never caches when the TTL is zero', async () => {
    const reads = make();
    const load = vi.fn(() => Promise.resolve('x'));

    await reads.getOrLoad('k', 0, load);
    await reads.getOrLoad('k', 0, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('reloads after invalidation', async () => {
    const reads = make();
    let value = 'old';
    const load = () => Promise.resolve(value);

    expect(await reads.getOrLoad('tasks:stats', 1000, load)).toBe('old');
    value = 'new';
    expect(await reads.getOrLoad('tasks:stats', 1000, load)).toBe('old'); // still cached

    await reads.invalidate('tasks:');
    expect(await reads.getOrLoad('tasks:stats', 1000, load)).toBe('new');
  });

  it('does not store a result that was being loaded when the data changed', async () => {
    const reads = make();
    const slowRead = deferred<string>();

    // A read starts and fetches the OLD data...
    const first = reads.getOrLoad('tasks:stats', 1000, () => slowRead.promise);
    // ...a write happens and invalidates while it is still running...
    await reads.invalidate('tasks:');
    // ...then the slow read finishes with its stale value.
    slowRead.resolve('stale');
    expect(await first).toBe('stale'); // the caller that asked gets what it loaded

    // Later readers must NOT be served that stale value from the cache.
    const load = vi.fn(() => Promise.resolve('current'));
    expect(await reads.getOrLoad('tasks:stats', 1000, load)).toBe('current');
    expect(load).toHaveBeenCalledOnce();
  });

  it('does not cache failures, and lets the next caller retry', async () => {
    const reads = make();
    await expect(
      reads.getOrLoad('k', 1000, () => Promise.reject(new Error('db down'))),
    ).rejects.toThrow('db down');

    const load = vi.fn(() => Promise.resolve('recovered'));
    expect(await reads.getOrLoad('k', 1000, load)).toBe('recovered');
  });
});
