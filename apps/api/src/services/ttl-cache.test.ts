import { TestClock } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { TtlCache } from './ttl-cache';

describe('TtlCache', () => {
  it('PERF-02 serves a cached value for 60 seconds on the injected clock, then reloads', async () => {
    const clock = new TestClock();
    clock.set(0);
    const cache = new TtlCache<number>(clock);
    let loads = 0;
    const load = async () => ++loads;
    expect(await cache.get('org-a', load)).toBe(1);
    clock.advance(59_999);
    expect(await cache.get('org-a', load)).toBe(1);
    clock.advance(1);
    expect(await cache.get('org-a', load)).toBe(2);
    expect(loads).toBe(2);
  });

  it('PERF-02 keeps keys apart, can be invalidated, and never caches a failure', async () => {
    const clock = new TestClock();
    const cache = new TtlCache<string>(clock);
    expect(await cache.get('a', async () => 'A')).toBe('A');
    expect(await cache.get('b', async () => 'B')).toBe('B');
    cache.delete('a');
    expect(await cache.get('a', async () => 'A2')).toBe('A2');
    await expect(cache.get('c', async () => Promise.reject(new Error('down')))).rejects.toThrow('down');
    expect(await cache.get('c', async () => 'C')).toBe('C');
  });
});

describe('TtlCache failures', () => {
  it('PERF-02 a late failure does not evict a newer entry for the same key', async () => {
    const clock = new TestClock();
    clock.set(0);
    const cache = new TtlCache<string>(clock, 1000);
    let fail!: (e: Error) => void;
    const first = cache.get('k', () => new Promise<string>((_, rej) => (fail = rej)));
    clock.advance(1000);
    expect(await cache.get('k', async () => 'fresh')).toBe('fresh');
    fail(new Error('slow failure'));
    await expect(first).rejects.toThrow('slow failure');
    expect(await cache.get('k', async () => 'reloaded')).toBe('fresh');
  });
});
