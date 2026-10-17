import { expect, type APIRequestContext } from '@playwright/test';
import { API_URL, TEST_SECRET } from '../../env';

// The API's test-only routes (docs/TEST_ENV.md, "Test-only API"). Registered only when NODE_ENV=test.

export interface PendingTask {
  name: string;
  path: string;
  scheduleTime: number;
}

export class TestApi {
  constructor(private readonly request: APIRequestContext) {}

  private async call<T>(method: 'GET' | 'POST', path: string, data?: unknown): Promise<T> {
    const res = await this.request.fetch(`${API_URL}${path}`, {
      method,
      headers: { 'x-test-secret': TEST_SECRET },
      ...(data === undefined ? {} : { data }),
    });
    expect(res.status(), `${method} ${path}: ${await res.text()}`).toBe(200);
    return (await res.json()) as T;
  }

  /** Clears all four emulators, puts the clock back on real time and loads the seed. */
  async reset(seed: 'base' | 'none' = 'base'): Promise<void> {
    await this.call('POST', '/__test/reset', { seed });
  }

  /** Adds scenario data (for example a scheduled test) and returns its IDs. */
  async seedScenario<T = Record<string, unknown>>(scenario: string, options: Record<string, unknown> = {}): Promise<T> {
    return this.call<T>('POST', `/__test/seed/${encodeURIComponent(scenario)}`, options);
  }

  readonly clock = {
    now: async (): Promise<number> => (await this.call<{ nowMs: number }>('GET', '/__test/clock')).nowMs,
    set: async (nowMs: number): Promise<number> =>
      (await this.call<{ nowMs: number }>('POST', '/__test/clock', { nowMs })).nowMs,
    advance: async (advanceMs: number): Promise<number> =>
      (await this.call<{ nowMs: number }>('POST', '/__test/clock', { advanceMs })).nowMs,
    followReal: async (): Promise<number> => (await this.call<{ nowMs: number }>('POST', '/__test/clock/real')).nowMs,
  };

  readonly tasks = {
    pending: async (): Promise<PendingTask[]> =>
      (await this.call<{ tasks: PendingTask[] }>('GET', '/__test/tasks')).tasks,
    runDue: async (): Promise<string[]> => (await this.call<{ ran: string[] }>('POST', '/__test/tasks/run-due')).ran,
  };
}
