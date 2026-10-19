import { firebaseAuth } from './firebase';
import { config } from './config';

/** An API failure in the shared error shape (API-01), carrying the stable code the UI maps to copy. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

let workspaceOrgId: string | null = null;
/** Super admins act inside an organization by sending X-Org-Id (API-04); set by the org switcher. */
export function setWorkspaceOrg(orgId: string | null): void {
  workspaceOrgId = orgId;
}

let clockOffsetMs = 0;
let measured = false;
/** Server time minus device time, measured from X-Server-Time (API-03, EX-06). */
export const serverClockOffset = () => clockOffsetMs;
/** An offset kept from an earlier visit, for an exam opened while the API can't be reached; a measurement wins. */
export function restoreClockOffset(ms: number): void {
  if (!measured) clockOffsetMs = ms;
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** For an optimistic change (UX-07): the request outlives the page, so a reload or a link right after still saves.
   * Only small bodies opt in: every keepalive request in flight shares the browser's 64 KiB budget. */
  keepalive?: boolean;
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const user = firebaseAuth().currentUser;
  const headers: Record<string, string> = { ...opts.headers };
  if (user) headers.authorization = `Bearer ${await user.getIdToken()}`;
  if (workspaceOrgId) headers['x-org-id'] = workspaceOrgId;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  // Device time is what the offset corrects, so this is the one place the client reads it directly.
  // eslint-disable-next-line no-restricted-properties
  const sentAt = Date.now();
  const method = opts.method ?? 'GET';
  const body = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const res = await fetch(`${config.apiUrl}${path}`, {
    method,
    headers,
    body,
    ...(opts.keepalive ? { keepalive: true } : {}),
  });
  const serverTime = Number(res.headers.get('x-server-time'));
  if (serverTime) {
    // eslint-disable-next-line no-restricted-properties
    clockOffsetMs = serverTime - (sentAt + Date.now()) / 2;
    measured = true;
  }
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiError(res.status, e?.code ?? 'INTERNAL', e?.message ?? 'Request failed', e?.details ?? {});
  }
  return json as T;
}

/** The current time by the server's clock, for display and defaults (EX-06); the API decides anything that counts. */
// eslint-disable-next-line no-restricted-properties
export const serverNow = () => Date.now() + clockOffsetMs;
/** This device's own time, for how long something has run here; a new clock offset never moves it. */
// eslint-disable-next-line no-restricted-properties
export const deviceNow = () => Date.now();
