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
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
    value.catch(() => this.entries.delete(key)); // never cache a failure
    return value;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }
}
