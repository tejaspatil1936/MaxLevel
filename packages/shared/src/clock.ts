/** Source of time for all domain code. Never call Date.now() outside this file. */
export interface Clock {
  /** Current time in epoch milliseconds (UTC). */
  now(): number;
}

export const systemClock: Clock = {
  now: () => Date.now(),
};

/**
 * Settable clock for tests (NODE_ENV=test only). It starts by following real time; `set` and `advance`
 * freeze it at a chosen instant, and `followReal` resumes real time from the current offset.
 */
export class TestClock implements Clock {
  private offsetMs = 0;
  private frozenAt: number | null = null;

  constructor(private readonly real: Clock = systemClock) {}

  now(): number {
    return this.frozenAt ?? this.real.now() + this.offsetMs;
  }

  set(ms: number): void {
    this.frozenAt = ms;
  }

  advance(ms: number): void {
    this.frozenAt = this.now() + ms;
  }

  /** Back to real time with no offset. */
  reset(): void {
    this.offsetMs = 0;
    this.frozenAt = null;
  }

  followReal(): void {
    if (this.frozenAt !== null) this.offsetMs = this.frozenAt - this.real.now();
    this.frozenAt = null;
  }
}
