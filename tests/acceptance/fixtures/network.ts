import { expect, type Page, type Request } from '@playwright/test';
import { API_URL } from '../../env';

// Holding API requests in the browser, so a test can see the state while a request is in flight (skeletons, optimistic
// updates, UX-07). Only the timing is controlled: a held request always goes on to the real API when released; the API
// is never answered for (CLAUDE.md fakes only the LLM and Cloud Tasks). For a refusal, make the real API refuse while
// the request is held (for example archive the organization), then release it.

export interface HeldRequests {
  /** Waits (up to the expect timeout) until a matching request is being held. */
  waitUntilHeld(): Promise<void>;
  /** Lets every held (and later) matching request go on to the real API. */
  release(): void;
}

export async function holdApiRequests(page: Page, match: (req: Request) => boolean): Promise<HeldRequests> {
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  let held = 0;

  await page.route(`${API_URL}/v1/**`, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS' || !match(req)) return route.continue();
    held++;
    await gate;
    return route.continue();
  });

  return {
    waitUntilHeld: async () => {
      await expect.poll(() => held, { message: 'a matching API request is held' }).toBeGreaterThan(0);
    },
    release: () => open(),
  };
}

/** Matches API requests by method and exact path, for example ('GET', '/v1/students'). */
export function apiRequest(method: string, path: string | RegExp) {
  return (req: Request) => {
    const p = new URL(req.url()).pathname;
    return req.method() === method && (typeof path === 'string' ? p === path : path.test(p));
  };
}

/** Records every API request the page sends, as `METHOD /path`, from now on (requests are not changed). */
export function recordApiCalls(page: Page): () => string[] {
  const calls: string[] = [];
  page.on('request', (req) => {
    if (!req.url().startsWith(API_URL) || req.method() === 'OPTIONS') return;
    calls.push(`${req.method()} ${new URL(req.url()).pathname}`);
  });
  return () => [...calls];
}

/** Matches any API request that changes something (POST, PUT, PATCH, DELETE). */
export const anyMutation = (req: Request) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method());

/**
 * Holds every request for the app's JavaScript (`/_next/static/**.js`) so a test can look at the page before any app
 * code runs (A11Y-02: preferences apply before first paint). `release` lets them all load.
 */
export async function holdAppScripts(page: Page): Promise<{ count(): number; release(): Promise<void> }> {
  const pattern = /\/_next\/static\/.*\.js(\?.*)?$/;
  const waiting: Array<() => void> = [];
  let held = 0;
  let released = false;
  await page.route(pattern, async (route) => {
    held++;
    if (!released) await new Promise<void>((resume) => waiting.push(resume));
    await route.continue();
  });
  return {
    count: () => held,
    release: async () => {
      released = true;
      // The route stays: once released it passes every request straight on. Removing it while held requests are
      // still continuing would handle them twice.
      for (const resume of waiting.splice(0)) resume();
    },
  };
}

/** Waits until the document body exists and every stylesheet has loaded. */
export async function waitForStyledDocument(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      document.body !== null &&
      Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).every((l) => l.sheet !== null),
  );
}
