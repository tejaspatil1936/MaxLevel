import type { Clock } from '@mitaoe/shared';

/** In-memory cache with a time-to-live measured on the injected Clock (PERF-02: 60 seconds). */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: Promise<V>; expiresAt: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly ttlMs = 60_000,
  ) {}

  get(key: string, load: () => Promise<V>): Promise<V> {
    const now = this.clock.now();
    const hit = this.entries.get(key);
    if (hit && hit.expiresAt > now) return hit.value;
    const value = load();
    const entry = { value, expiresAt: now + this.ttlMs };
    this.entries.set(key, entry);
    // Never cache a failure, but leave a newer entry for the same key alone.
    value.catch(() => this.entries.get(key) === entry && this.entries.delete(key));
    return value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }
}
