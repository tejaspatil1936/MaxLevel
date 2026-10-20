import { createHash } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';
import { API_URL } from '../../env';
import type { Emulators } from './emulators';
import type { SeedAccount } from './seed';

// Calls to the real API with real ID tokens from the Auth emulator (docs/TEST_ENV.md). Used to prove wrong-role
// refusals, tenant isolation (ORG-05) and super-admin parity (ORG-14). Contract: docs/testids/phase-1.md,
// "Requests the tests send directly".

const AUTH = 'http://127.0.0.1:9099';
const API_KEY = 'demo-key';

export interface ApiResponse<T = Record<string, unknown>> {
  status: number;
  body: T;
}

/** The `error.code` of an API-01 error body, or undefined. */
export function errorCode(res: ApiResponse<unknown>): string | undefined {
  const body = res.body as { error?: { code?: string } } | null;
  return body?.error?.code;
}

export class ApiClient {
  constructor(
    private readonly request: APIRequestContext,
    /** The ID token this client sends; kept as issued so revocation can be checked (AUTH-05, AUTH-06). */
    readonly idToken: string,
    /** Sent as X-Org-Id (super admins acting in an organization, API-04). */
    readonly orgId?: string,
  ) {}

  /** The same signed-in user acting inside another organization (super admins only). */
  inOrg(orgId: string): ApiClient {
    return new ApiClient(this.request, this.idToken, orgId);
  }

  async call<T = Record<string, unknown>>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    data?: unknown,
    headers: Record<string, string> = {},
  ): Promise<ApiResponse<T>> {
    const res = await this.request.fetch(`${API_URL}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.idToken}`,
        ...(this.orgId ? { 'x-org-id': this.orgId } : {}),
        ...headers,
      },
      ...(data === undefined ? {} : { data }),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    return { status: res.status(), body: body as T };
  }

  get<T = Record<string, unknown>>(path: string) {
    return this.call<T>('GET', path);
  }
  post<T = Record<string, unknown>>(path: string, data: unknown = {}, headers?: Record<string, string>) {
    return this.call<T>('POST', path, data, headers);
  }
  put<T = Record<string, unknown>>(path: string, data: unknown, headers?: Record<string, string>) {
    return this.call<T>('PUT', path, data, headers);
  }
  patch<T = Record<string, unknown>>(path: string, data: unknown) {
    return this.call<T>('PATCH', path, data);
  }
  delete<T = Record<string, unknown>>(path: string) {
    return this.call<T>('DELETE', path);
  }
}

/**
 * Signs in to the Auth emulator with an unsigned Google credential (as the web app's emulator helper does), runs
 * bootstrap, refreshes the token so it carries the claims, and returns a client. An account that already exists keeps
 * its Google subject, so the same uid is used as in the browser.
 */
export async function signInToApi(
  request: APIRequestContext,
  emulators: Emulators,
  account: SeedAccount,
  opts: { orgId?: string } = {},
): Promise<ApiClient> {
  const existing = await emulators.authAccounts(account.email);
  const sub = existing[0]?.googleSub ?? `api-${createHash('sha256').update(account.email).digest('hex').slice(0, 16)}`;
  const idTokenClaims = JSON.stringify({ sub, email: account.email, email_verified: true, name: account.name });
  const signIn = await request.post(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=${API_KEY}`, {
    data: {
      postBody: `id_token=${encodeURIComponent(idTokenClaims)}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnSecureToken: true,
      returnIdpCredential: true,
    },
  });
  expect(signIn.status(), `emulator sign-in of ${account.email}: ${await signIn.text()}`).toBe(200);
  const { idToken, refreshToken } = (await signIn.json()) as { idToken: string; refreshToken: string };

  const boot = await request.post(`${API_URL}/v1/session/bootstrap`, {
    headers: { authorization: `Bearer ${idToken}` },
    data: {},
  });
  expect(boot.status(), `bootstrap of ${account.email}: ${await boot.text()}`).toBe(200);

  const refreshed = await request.post(`${AUTH}/securetoken.googleapis.com/v1/token?key=${API_KEY}`, {
    form: { grant_type: 'refresh_token', refresh_token: refreshToken },
  });
  expect(refreshed.status(), `token refresh of ${account.email}: ${await refreshed.text()}`).toBe(200);
  const { id_token } = (await refreshed.json()) as { id_token: string };
  return new ApiClient(request, id_token, opts.orgId);
}
