import { expect, type Locator, type Page, type Request } from '@playwright/test';

// Observing the real browser APIs the exam uses: camera streams, the screen wake lock, every request and WebSocket
// message a page sends, and whether the app prevented a key or clipboard event. These wrappers count and keep
// references; they never replace a result (CLAUDE.md: only the LLM and Cloud Tasks are faked).

type SpyWindow = Window & {
  __streams?: MediaStream[];
  __wakeLocks?: number;
  __fetchTimes?: Array<{ method: string; url: string; at: number }>;
  __prevented?: Array<{ type: string; key?: string; prevented: boolean }>;
};

/** Keeps every MediaStream that getUserMedia returns, so a test can see whether its tracks are still live. */
export async function installCameraSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as SpyWindow;
    w.__streams = [];
    const md = navigator.mediaDevices;
    if (!md || typeof md.getUserMedia !== 'function') return;
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (constraints?: MediaStreamConstraints) => {
      const stream = await original(constraints);
      w.__streams!.push(stream);
      return stream;
    };
  });
}

/** Video tracks of every stream the page opened: whether each is live and enabled. */
export async function cameraTracks(page: Page): Promise<Array<{ live: boolean; enabled: boolean }>> {
  return page.evaluate(() =>
    ((window as SpyWindow).__streams ?? []).flatMap((s) =>
      s.getVideoTracks().map((t) => ({ live: t.readyState === 'live', enabled: t.enabled })),
    ),
  );
}

/** Counts navigator.wakeLock.request calls (the real request still runs). */
export async function installWakeLockSpy(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as SpyWindow;
    w.__wakeLocks = 0;
    const wl = (navigator as Partial<Navigator>).wakeLock;
    if (!wl) return;
    const original = wl.request.bind(wl);
    wl.request = (type?: 'screen') => {
      w.__wakeLocks = (w.__wakeLocks ?? 0) + 1;
      return original(type);
    };
  });
}

export async function wakeLockRequests(page: Page): Promise<number> {
  return page.evaluate(() => (window as SpyWindow).__wakeLocks ?? -1);
}

/**
 * Records, in the page, the device-clock time (Date.now, faked when page.clock is installed) at which each fetch or
 * XHR whose URL matches `pattern` is sent.
 */
export async function installRequestTimer(page: Page, pattern: RegExp): Promise<void> {
  await page.addInitScript(
    ({ source, flags }) => {
      const w = window as SpyWindow;
      const re = new RegExp(source, flags);
      w.__fetchTimes = [];
      const record = (method: string, url: string) => {
        if (re.test(url)) w.__fetchTimes!.push({ method: method.toUpperCase(), url, at: Date.now() });
      };
      const originalFetch = window.fetch.bind(window);
      window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
        record(method, url);
        return originalFetch(input, init);
      };
      const open = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (
        this: XMLHttpRequest,
        method: string,
        url: string | URL,
        ...rest: unknown[]
      ) {
        record(method, String(url));
        return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
      } as typeof XMLHttpRequest.prototype.open;
    },
    { source: pattern.source, flags: pattern.flags },
  );
}

export async function requestTimes(page: Page, method: string): Promise<number[]> {
  return page.evaluate(
    (m) => ((window as SpyWindow).__fetchTimes ?? []).filter((r) => r.method === m).map((r) => r.at),
    method,
  );
}

export interface SentRequest {
  method: string;
  url: string;
  host: string;
  contentType: string;
  bodyBytes: number;
  carriesImage: boolean;
}

export interface Traffic {
  requests(): SentRequest[];
  /** Sizes of WebSocket messages the page sent, and whether any looked like image data. */
  frames(): Array<{ url: string; bytes: number; carriesImage: boolean }>;
}

const IMAGE_MARKERS = /data:image\/|data:video\/|image\/(jpeg|png|webp)|video\/(webm|mp4)|;base64,/i;

function describeRequest(req: Request): SentRequest {
  const url = new URL(req.url());
  const body = req.postDataBuffer();
  const contentType = req.headers()['content-type'] ?? '';
  const text = body ? body.toString('latin1') : '';
  return {
    method: req.method(),
    url: req.url(),
    host: url.host,
    contentType,
    bodyBytes: body?.length ?? 0,
    carriesImage:
      /^(image|video)\/|multipart\//i.test(contentType) ||
      IMAGE_MARKERS.test(text) ||
      /\x89PNG|\xff\xd8\xff/.test(text),
  };
}

/** Records every request (any host) and every WebSocket message the page sends from now on. */
export function recordTraffic(page: Page): Traffic {
  const requests: SentRequest[] = [];
  const frames: Array<{ url: string; bytes: number; carriesImage: boolean }> = [];
  page.on('request', (req) => {
    if (req.url().startsWith('data:') || req.url().startsWith('blob:')) return;
    requests.push(describeRequest(req));
  });
  page.on('websocket', (ws) => {
    ws.on('framesent', (f) => {
      const payload = typeof f.payload === 'string' ? f.payload : f.payload.toString('latin1');
      frames.push({ url: ws.url(), bytes: payload.length, carriesImage: IMAGE_MARKERS.test(payload) });
    });
  });
  return { requests: () => [...requests], frames: () => [...frames] };
}

/** Hosts the exam and phone pages may talk to in tests: web, API, Auth emulator, Realtime Database emulator. */
export const ALLOWED_HOSTS = ['localhost:3000', 'localhost:4000', '127.0.0.1:9099', '127.0.0.1:9000', 'localhost:9000'];

/** PR-02, PR-17: nothing sent that carries image or video data, and nothing sent anywhere else. */
export function expectNoMediaSent(traffic: Traffic): void {
  const requests = traffic.requests();
  expect(requests.length, 'requests were recorded').toBeGreaterThan(0);
  expect(
    requests.filter((r) => !ALLOWED_HOSTS.includes(r.host)).map((r) => r.url),
    'requests to other hosts',
  ).toEqual([]);
  expect(
    requests.filter((r) => r.carriesImage || r.bodyBytes > 16_384).map((r) => `${r.method} ${r.url} ${r.bodyBytes} B`),
    'requests carrying image or video data',
  ).toEqual([]);
  expect(
    traffic
      .frames()
      .filter((f) => f.carriesImage || f.bytes > 16_384)
      .map((f) => `${f.url} ${f.bytes} B`),
    'WebSocket messages carrying image or video data',
  ).toEqual([]);
}

/**
 * Records, for keydown, copy, cut, paste and contextmenu events reaching the window, whether the app prevented them
 * (read after dispatch has finished, so listener order does not matter).
 */
export async function installPreventionRecorder(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as SpyWindow;
    w.__prevented = [];
    for (const type of ['keydown', 'copy', 'cut', 'paste', 'contextmenu']) {
      window.addEventListener(
        type,
        (e) => {
          const key = (e as KeyboardEvent).key;
          setTimeout(() => w.__prevented!.push({ type, ...(key ? { key } : {}), prevented: e.defaultPrevented }), 0);
        },
        true,
      );
    }
  });
}

/** Waits for the recorded event and returns whether it was prevented. */
export async function wasPrevented(page: Page, type: string, key?: string): Promise<boolean> {
  let found: boolean | undefined;
  await expect
    .poll(
      async () => {
        const list = await page.evaluate(() => (window as SpyWindow).__prevented ?? []);
        const match = list.filter((r) => r.type === type && (key === undefined || r.key === key)).pop();
        found = match?.prevented;
        return match !== undefined;
      },
      { message: `${type}${key ? ` ${key}` : ''} event observed` },
    )
    .toBe(true);
  return found!;
}

/** Dispatches a cancelable clipboard or context-menu event on an element; true when the app prevented it. */
export async function dispatchPrevented(
  target: Locator,
  type: 'copy' | 'cut' | 'paste' | 'contextmenu',
): Promise<boolean> {
  return target.evaluate((el, t) => {
    const event =
      t === 'contextmenu'
        ? new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
        : new ClipboardEvent(t, { bubbles: true, cancelable: true, clipboardData: new DataTransfer() });
    return !el.dispatchEvent(event);
  }, type);
}

/**
 * Leaving the exam tab and coming back (PR-05). Playwright keeps every Chromium page "visible" and focused, even headed
 * (all tabs report `visibilityState: 'visible'` after bringToFront, and focus is emulated), so a real tab switch cannot
 * be produced. This sends the browser's own sequence for one: `blur`, then `visibilitychange` with the page hidden, then
 * `visibilitychange` visible again and `focus`, with `document.visibilityState` and `document.hidden` reporting each
 * state. The app's real listeners handle them.
 */
export async function leaveTabAndReturn(page: Page): Promise<void> {
  await page.evaluate(() => {
    const report = (hidden: boolean) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => (hidden ? 'hidden' : 'visible'),
      });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
    };
    window.dispatchEvent(new FocusEvent('blur'));
    report(true);
    document.dispatchEvent(new Event('visibilitychange'));
    report(false);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new FocusEvent('focus'));
  });
}

/** The text the page has selected right now. */
export async function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

/**
 * Screenshots of each element with every colour forced to black on white (text, backgrounds, borders, outlines, SVG
 * fills and strokes), so what is left to tell them apart is shape, pattern, icon or words (A11Y-14, UI-02).
 */
export async function colourBlindShots(page: Page, elements: Locator): Promise<Buffer[]> {
  await page.addStyleTag({
    content: `[data-colour-neutral], [data-colour-neutral] *, [data-colour-neutral]::before, [data-colour-neutral]::after,
      [data-colour-neutral] *::before, [data-colour-neutral] *::after {
        color: #000 !important; background-color: #fff !important; border-color: #000 !important;
        outline-color: #000 !important; text-decoration-color: #000 !important; caret-color: #000 !important;
        transition: none !important; animation: none !important; }`,
  });
  const count = await elements.count();
  const shots: Buffer[] = [];
  for (let i = 0; i < count; i++) {
    const el = elements.nth(i);
    await el.evaluate((root) => {
      root.setAttribute('data-colour-neutral', '');
      for (const node of [root, ...Array.from(root.querySelectorAll('*'))]) {
        if (!(node instanceof SVGElement)) continue;
        const cs = getComputedStyle(node);
        if (cs.fill !== 'none') node.style.setProperty('fill', '#000', 'important');
        if (cs.stroke !== 'none') node.style.setProperty('stroke', '#000', 'important');
      }
    });
    shots.push(await el.screenshot({ animations: 'disabled' }));
  }
  return shots;
}
