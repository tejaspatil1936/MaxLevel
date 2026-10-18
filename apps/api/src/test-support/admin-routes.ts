import type { Firestore } from 'firebase-admin/firestore';

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
  /** Creates a fresh org A resource before each call, for routes that create or delete (n differs per call). */
  fresh?: (db: Firestore, n: number) => Promise<{ params?: Record<string, string>; body?: unknown }>;
}

const newDepartment = async (db: Firestore, n: number) => {
  const ref = db.collection('organizations/org-a/departments').doc(`dept-fresh-${n}`);
  await ref.set({ orgId: 'org-a', name: `Fresh ${n}`, status: 'active' });
  return ref.id;
};

/** A series with a fixed ID in an org, so samples can name it in params. */
const seriesIn = async (db: Firestore, orgId: string, id: string) => {
  await db.doc(`organizations/${orgId}/series/${id}`).set({
    orgId,
    title: `Series ${id}`,
    status: 'draft',
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    dailyWindow: { startMinutes: 600, endMinutes: 660 },
    defaults: {},
    eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
    createdAt: 0,
    updatedAt: 0,
  });
  return id;
};
const withSeries = async (db: Firestore) => {
  await seriesIn(db, 'org-b', 'series-org-b');
  return { params: { id: await seriesIn(db, 'org-a', 'series-org-a') } };
};
const noRules = { departmentIds: [], graduationYears: [], include: [], exclude: [] };

/** A draft test with a fixed ID in each org's sample series. */
const testIn = async (db: Firestore, orgId: string, id: string) => {
  const seriesId = await seriesIn(db, orgId, `series-${orgId}`);
  await db.doc(`organizations/${orgId}/tests/${id}`).set({
    orgId,
    seriesId,
    title: `Test ${id}`,
    dayHidden: false,
    scheduledDate: '2026-11-02',
    overrides: {},
    eligibility: noRules,
    sections: [],
    status: 'draft',
    questionSetVersion: 1,
    totalMarks: 0,
    attemptsStarted: false,
    createdAt: 0,
    updatedAt: 0,
  });
  return id;
};
const withTest = async (db: Firestore) => {
  await testIn(db, 'org-b', 'test-org-b');
  return { params: { id: await testIn(db, 'org-a', 'test-org-a') } };
};

export const ADMIN_ROUTE_SAMPLES: Record<string, AdminRouteSample> = {
  'GET /v1/org': {},
  'PATCH /v1/org/settings': { body: { profileLocked: false } },

  'GET /v1/departments': {},
  'POST /v1/departments': { fresh: async (_db, n) => ({ body: { name: `Department ${n}` } }) },
  'PATCH /v1/departments/:id': {
    params: { id: 'dept-org-a-it' },
    foreignParams: { id: 'dept-org-b-civil' },
    fresh: async (_db, n) => ({ body: { name: `IT ${n}` } }),
  },
  'POST /v1/departments/:id/merge': {
    foreignParams: { id: 'dept-org-b-civil' },
    body: { intoId: 'dept-org-a-computer' },
    fresh: async (db, n) => ({ params: { id: await newDepartment(db, n) }, body: { intoId: 'dept-org-a-computer' } }),
  },
  'DELETE /v1/departments/:id': {
    foreignParams: { id: 'dept-org-b-civil' },
    fresh: async (db, n) => ({ params: { id: await newDepartment(db, n) } }),
  },

  'GET /v1/whitelist': {},
  'POST /v1/whitelist/import': { body: { mode: 'preview', source: 'paste', rows: [{ email: 'new@a.test' }] } },
  'POST /v1/whitelist/bulk': { body: { action: 'disable', emails: ['invited05@a.test'] } },

  'GET /v1/students': {},
  'POST /v1/students': {
    fresh: async (_db, n) => ({
      body: {
        email: `manual${n}@a.test`,
        name: `Manual ${n}`,
        prn: `MAN-${n}`,
        departmentId: 'dept-org-a-computer',
        graduationYear: 2027,
      },
    }),
  },
  'GET /v1/students/:id': { params: { id: 'stu-org-a-01' }, foreignParams: { id: 'stu-org-b-01' } },
  'PATCH /v1/students/:id': {
    params: { id: 'stu-org-a-02' },
    foreignParams: { id: 'stu-org-b-02' },
    body: { name: 'Ishita D.' },
  },
  'DELETE /v1/students/:id': {
    foreignParams: { id: 'stu-org-b-03' },
    fresh: async (db, n) => {
      const ref = db.collection('organizations/org-a/students').doc(`stu-fresh-${n}`);
      await ref.set({
        orgId: 'org-a',
        email: `fresh${n}@a.test`,
        name: 'Fresh',
        prn: `F-${n}`,
        departmentId: 'dept-org-a-it',
        graduationYear: 2027,
        status: 'invited',
        uid: null,
        createdAt: 0,
        updatedAt: 0,
      });
      return { params: { id: ref.id } };
    },
  },

  'GET /v1/series': {},
  'POST /v1/series': {
    fresh: async (_db, n) => ({
      body: {
        title: `Series ${n}`,
        startDate: '2026-11-01',
        endDate: '2026-11-30',
        dailyWindow: { startMinutes: 600, endMinutes: 660 },
        defaults: {},
        eligibility: noRules,
      },
    }),
  },
  'GET /v1/series/:id': { foreignParams: { id: 'series-org-b' }, fresh: withSeries },
  'PATCH /v1/series/:id': {
    foreignParams: { id: 'series-org-b' },
    fresh: async (db, n) => ({ ...(await withSeries(db)), body: { title: `Renamed ${n}` } }),
  },
  'POST /v1/series/:id/eligibility/preview': {
    foreignParams: { id: 'series-org-b' },
    fresh: async (db) => ({ ...(await withSeries(db)), body: { eligibility: noRules } }),
  },

  'GET /v1/tests': {
    fresh: async (db) => {
      await withSeries(db);
      return {};
    },
    query: { seriesId: 'series-org-a' },
  },
  'POST /v1/tests': {
    fresh: async (db, n) => {
      await withSeries(db);
      return { body: { seriesId: 'series-org-a', title: `Test ${n}`, scheduledDate: '2026-11-03' } };
    },
  },
  'GET /v1/tests/:id': { foreignParams: { id: 'test-org-b' }, fresh: withTest },
  'PATCH /v1/tests/:id': {
    foreignParams: { id: 'test-org-b' },
    fresh: async (db, n) => ({ ...(await withTest(db)), body: { title: `Renamed ${n}` } }),
  },
  'POST /v1/tests/:id/eligibility/preview': {
    foreignParams: { id: 'test-org-b' },
    fresh: async (db) => ({ ...(await withTest(db)), body: { eligibility: noRules } }),
  },

  'GET /v1/audit': {},
};

export const fillPath = (url: string, params: Record<string, string> = {}) =>
  url.replace(/:(\w+)/g, (_, k: string) => {
    if (!(k in params)) throw new Error(`no sample value for :${k} in ${url}`);
    return encodeURIComponent(params[k]!);
  });
