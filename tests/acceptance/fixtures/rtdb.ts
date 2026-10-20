import { expect, type APIRequestContext, type Page, type Route, type WebSocketRoute } from '@playwright/test';

// Realtime Database on the emulator (docs/TEST_ENV.md): reads over its REST endpoint with the owner credential (rules
// bypassed), only to check what was stored; and a way to make it unreachable from one page (REL-05). Nothing about
// the database is faked: the outage drops the page's real connection and refuses new ones.

const RTDB = 'http://127.0.0.1:9000';
const NS = 'demo-mitaoe-default-rtdb';

export interface DevicePresence {
  online?: boolean;
  lastSeen?: number;
  cameraOn?: boolean;
  fullscreen?: boolean;
  visible?: boolean;
}

export class Rtdb {
  constructor(private readonly request: APIRequestContext) {}

  /** The value at a path, or null. */
  async get<T = unknown>(path: string): Promise<T | null> {
    const res = await this.request.get(`${RTDB}/${path.replace(/^\/+/, '')}.json?ns=${NS}`, {
      headers: { authorization: 'Bearer owner' },
    });
    expect(res.status(), await res.text()).toBe(200);
    return (await res.json()) as T | null;
  }

  presence(orgId: string, testId: string, attemptId: string, device: 'laptop' | 'phone') {
    return this.get<DevicePresence>(`presence/${orgId}/${testId}/${attemptId}/${device}`);
  }

  /** Waits until the device's presence record matches. */
  async expectPresence(
    orgId: string,
    testId: string,
    attemptId: string,
    device: 'laptop' | 'phone',
    expected: DevicePresence & Record<string, unknown>,
  ): Promise<void> {
    await expect
      .poll(async () => this.presence(orgId, testId, attemptId, device), {
        message: `${device} presence of ${attemptId}`,
        timeout: 20_000,
      })
      .toMatchObject(expected);
  }
}

export interface RtdbLink {
  /** Drops the page's open Realtime Database connections and refuses new ones until `restore`. */
  cut(): Promise<void>;
  restore(): void;
}

/** Install before the page connects: passes Realtime Database traffic through until `cut()` is called. */
export async function controllableRtdb(page: Page): Promise<RtdbLink> {
  let down = false;
  const open: Array<{ page: WebSocketRoute; server: WebSocketRoute }> = [];
  await page.routeWebSocket(/^wss?:\/\/(127\.0\.0\.1|localhost):9000\//, (ws) => {
    if (down) {
      void ws.close({ code: 4000, reason: 'test outage' }).catch(() => undefined);
      return;
    }
    const server = ws.connectToServer();
    open.push({ page: ws, server });
  });
  await page.route(/^https?:\/\/(127\.0\.0\.1|localhost):9000\//, (route: Route) =>
    down ? route.abort('connectionrefused') : route.continue(),
  );
  return {
    cut: async () => {
      down = true;
      for (const c of open.splice(0)) {
        await c.server.close().catch(() => undefined);
        await c.page.close({ code: 4000, reason: 'test outage' }).catch(() => undefined);
      }
    },
    restore: () => {
      down = false;
    },
  };
}
