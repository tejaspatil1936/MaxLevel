// Sample requests for every admin route, used by the route-table tests (ORG-05, ORG-11, ORG-14).
// Adding an admin route without a sample here fails those tests, so every admin route is exercised with both an
// admin token and a super-admin token, and every route that takes an ID is tried with another org's ID.

export interface AdminRouteSample {
  /** Path params for a resource that exists in org A (the caller's org). */
  params?: Record<string, string>;
  /** Path params for a resource that exists only in org B; org A's admin must get 404 (ORG-05). */
  foreignParams?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  /** Seed extra data before the call (receives an emulator Firestore). */
}

export const ADMIN_ROUTE_SAMPLES: Record<string, AdminRouteSample> = {
  'GET /v1/org': {},
  'PATCH /v1/org/settings': { body: { profileLocked: false } },
};

export const fillPath = (url: string, params: Record<string, string> = {}) =>
  url.replace(/:(\w+)/g, (_, k: string) => {
    if (!(k in params)) throw new Error(`no sample value for :${k} in ${url}`);
    return encodeURIComponent(params[k]!);
  });
