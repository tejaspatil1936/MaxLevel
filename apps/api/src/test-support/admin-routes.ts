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

/** An import job awaiting its upload, with a fixed ID in each org's sample test. */
const withImportJob = async (db: Firestore) => {
  for (const orgId of ['org-a', 'org-b']) {
    const testId = await testIn(db, orgId, `test-${orgId}`);
    await db.doc(`organizations/${orgId}/importJobs/import-${orgId}`).set({
      orgId,
      testId,
      filename: 'questions.json',
      format: 'json',
      contentType: 'application/json',
      sizeBytes: 10,
      filePath: `organizations/${orgId}/imports/import-${orgId}/source.json`,
      status: 'awaiting_upload',
      progress: { pagesDone: 0, pagesTotal: 0, questionsFound: 0 },
      createdBy: 'seed',
      createdAt: 0,
    });
  }
  return { params: { id: 'import-org-a' } };
};

/** A ready import job in each org's sample test with one pending draft, `d0001`. */
const withImportDraft = async (db: Firestore) => {
  await withImportJob(db);
  for (const orgId of ['org-a', 'org-b']) {
    const job = db.doc(`organizations/${orgId}/importJobs/import-${orgId}`);
    await job.update({ status: 'ready', progress: { pagesDone: 1, pagesTotal: 1, questionsFound: 1 } });
    await job
      .collection('drafts')
      .doc('d0001')
      .set({
        order: 1,
        sourcePage: 1,
        prompt: 'What is 2 + 2?',
        options: [
          { id: 'a', text: '3' },
          { id: 'b', text: '4' },
        ],
        correctOptionIds: ['b'],
        difficultySuggested: false,
        images: [],
        flags: [],
        status: 'pending',
      });
  }
  return { id: 'import-org-a', draftId: 'd0001' };
};

/** The sample test in each org, published with a manual release, its results released when `released`. */
const withPublishedTest = async (db: Firestore, released = false) => {
  const resolved = {
    timingMode: 'fixed',
    window: { start: 0, end: 3_600_000 },
    resultRelease: 'manual',
    resultDetail: 'score',
    maxStrikes: 3,
  };
  const fields = { status: 'scheduled', resolved, ...(released ? { resultsReleasedAt: 1 } : {}) };
  const { params } = await withTest(db);
  for (const [orgId, id] of [
    ['org-a', params.id],
    ['org-b', 'test-org-b'],
  ] as const)
    await db.doc(`organizations/${orgId}/tests/${id}`).update(fields);
  return { params, body: {} };
};

/** A question with a fixed ID in each org's sample test; `n` makes a fresh one for routes that delete. */
const questionIn = async (db: Firestore, orgId: string, id: string) => {
  const testId = await testIn(db, orgId, `test-${orgId}`);
  await db.doc(`organizations/${orgId}/tests/${testId}/questions/${id}`).set({
    orgId,
    testId,
    order: 1,
    type: 'single',
    prompt: `Question ${id}`,
    images: [],
    options: [
      { id: 'a', text: '3' },
      { id: 'b', text: '4' },
    ],
    correctOptionIds: ['b'],
    tags: [],
    source: { kind: 'manual' },
    status: 'approved',
    createdAt: 0,
    updatedAt: 0,
  });
  return { id: testId, questionId: id };
};
const withQuestion = async (db: Firestore, n = 0) => {
  await questionIn(db, 'org-b', 'q-org-b');
  return { params: await questionIn(db, 'org-a', n ? `q-fresh-${n}` : 'q-org-a') };
};
const questionBody = {
  prompt: 'What is 2 + 2?',
  options: [
    { id: 'a', text: '3' },
    { id: 'b', text: '4' },
  ],
  correctOptionIds: ['b'],
};
const foreignQuestion = { id: 'test-org-b', questionId: 'q-org-b' };
/** An attempt with a fixed ID in each org, with one logged event. */
const attemptIn = async (db: Firestore, orgId: string, id: string) => {
  const ref = db.doc(`organizations/${orgId}/attempts/${id}`);
  await ref.set({ orgId, testId: `test-${orgId}`, studentId: `stu-${orgId}-01`, status: 'in_progress', startedAt: 0 });
  await ref
    .collection('events')
    .doc('evt-1')
    .set({ orgId, type: 'window_blur', details: {}, clientTs: 0, serverTs: 0 });
  return id;
};
const withAttempt = async (db: Firestore) => {
  await attemptIn(db, 'org-b', 'att-org-b');
  return { params: { id: await attemptIn(db, 'org-a', 'att-org-a') } };
};
/** The sample attempt in progress in each org's published sample test, with a deadline and no extra time yet. */
const withTimedAttempt = async (db: Firestore) => {
  await withPublishedTest(db);
  const { params } = await withAttempt(db);
  for (const [orgId, id] of [
    ['org-a', params.id],
    ['org-b', 'att-org-b'],
  ] as const)
    await db.doc(`organizations/${orgId}/attempts/${id}`).update({ deadlineAt: 3_600_000, extraTimeSec: 0 });
  return { params, body: { minutes: 5, reason: 'Network outage' } };
};

/** The sample attempt in each org's published sample test, with this status, an empty draw and a deadline. */
const withActionAttempt = (status: string) => async (db: Firestore) => {
  await withPublishedTest(db);
  const { params } = await withAttempt(db);
  for (const [orgId, id] of [
    ['org-a', params.id],
    ['org-b', 'att-org-b'],
  ] as const)
    await db.doc(`organizations/${orgId}/attempts/${id}`).update({
      status,
      seriesId: `series-${orgId}`,
      uid: `uid-${orgId}`,
      deadlineAt: 3_600_000,
      extraTimeSec: 0,
      strikesCount: 0,
      questionServedAt: {},
      draw: { questionIds: [], optionOrder: {}, sections: [] },
    });
  return { params, body: { reason: 'Reviewed the recording' } };
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
  'POST /v1/tests/:id/approve': {
    foreignParams: { id: 'test-org-b' },
    fresh: async (db) => ({ params: { id: (await withQuestion(db)).params.id }, body: {} }),
  },
  'POST /v1/tests/:id/publish': {
    foreignParams: { id: 'test-org-b' },
    fresh: async (db) => ({ ...(await withTest(db)), body: {} }),
  },
  'GET /v1/results': { fresh: (db) => withPublishedTest(db) },
  'GET /v1/tests/:id/release': { foreignParams: { id: 'test-org-b' }, fresh: (db) => withPublishedTest(db) },
  'POST /v1/tests/:id/release': { foreignParams: { id: 'test-org-b' }, fresh: (db) => withPublishedTest(db) },
  'POST /v1/tests/:id/withdraw-results': {
    foreignParams: { id: 'test-org-b' },
    fresh: (db) => withPublishedTest(db, true),
  },
  'GET /v1/leaderboards/:boardId': {
    foreignParams: { boardId: 'test_test-org-b' },
    fresh: async (db) => {
      await withPublishedTest(db, true);
      return { params: { boardId: 'test_test-org-a' } };
    },
  },
  'POST /v1/exports': {
    fresh: async (db) => {
      const { params } = await withPublishedTest(db);
      return { body: { scope: 'test', refId: params.id, format: 'csv' } };
    },
  },
  'GET /v1/exports/:id': {
    params: { id: 'export-org-a' },
    foreignParams: { id: 'export-org-b' },
    fresh: async (db) => {
      for (const orgId of ['org-a', 'org-b'])
        await db.doc(`organizations/${orgId}/exports/export-${orgId}`).set({
          orgId,
          scope: 'test',
          refId: `test-${orgId}`,
          format: 'csv',
          status: 'queued',
          filePath: `organizations/${orgId}/exports/export-${orgId}/results-test-${orgId}.csv`,
          filename: `results-test-${orgId}.csv`,
          createdBy: 'seed',
          createdAt: 0,
        });
      return { params: { id: 'export-org-a' } };
    },
  },
  'POST /v1/imports': {
    fresh: async (db) => {
      const { params } = await withTest(db);
      return {
        body: { testId: params.id, filename: 'questions.json', contentType: 'application/json', sizeBytes: 10 },
      };
    },
  },
  'GET /v1/imports': { query: { testId: 'test-org-a' }, fresh: withTest },
  'GET /v1/imports/:id': {
    params: { id: 'import-org-a' },
    foreignParams: { id: 'import-org-b' },
    fresh: withImportJob,
  },
  'POST /v1/imports/:id/start': {
    params: { id: 'import-org-a' },
    foreignParams: { id: 'import-org-b' },
    body: {},
    fresh: withImportJob,
  },
  'POST /v1/imports/:id/retry': {
    params: { id: 'import-org-a' },
    foreignParams: { id: 'import-org-b' },
    body: {},
    fresh: withImportJob,
  },
  'GET /v1/imports/:id/pages/:page': {
    params: { id: 'import-org-a', page: '1' },
    foreignParams: { id: 'import-org-b', page: '1' },
    fresh: async (db) => ({ params: { ...(await withImportJob(db)).params, page: '1' } }),
  },
  'GET /v1/imports/:id/parts/:part': {
    params: { id: 'import-org-a', part: '1' },
    foreignParams: { id: 'import-org-b', part: '1' },
    fresh: async (db) => ({ params: { ...(await withImportJob(db)).params, part: '1' } }),
  },
  'PATCH /v1/imports/:id/drafts/:draftId': {
    foreignParams: { id: 'import-org-b', draftId: 'd0001' },
    fresh: async (db, n) => ({ params: await withImportDraft(db), body: { prompt: `Edited ${n}` } }),
  },
  'POST /v1/imports/:id/approve': {
    foreignParams: { id: 'import-org-b' },
    fresh: async (db) => ({ params: { id: (await withImportDraft(db)).id }, body: { draftIds: ['d0001'] } }),
  },
  'POST /v1/imports/:id/discard': {
    foreignParams: { id: 'import-org-b' },
    fresh: async (db) => ({ params: { id: (await withImportDraft(db)).id }, body: { draftIds: ['d0001'] } }),
  },
  'GET /v1/tests/:id/questions': { foreignParams: { id: 'test-org-b' }, fresh: withTest },
  'GET /v1/tests/:id/preview': { foreignParams: { id: 'test-org-b' }, fresh: withTest },
  'POST /v1/tests/:id/questions': {
    foreignParams: { id: 'test-org-b' },
    fresh: async (db) => ({ ...(await withTest(db)), body: questionBody }),
  },
  'PATCH /v1/tests/:id/questions/:questionId': {
    foreignParams: foreignQuestion,
    fresh: async (db, n) => ({ ...(await withQuestion(db)), body: { prompt: `Edited ${n}` } }),
  },
  'DELETE /v1/tests/:id/questions/:questionId': {
    foreignParams: foreignQuestion,
    fresh: async (db, n) => withQuestion(db, n + 1),
  },
  'PUT /v1/tests/:id/questions/order': {
    foreignParams: { id: 'test-org-b' },
    fresh: async (db) => {
      const { params } = await withQuestion(db);
      const ids = (await db.collection(`organizations/org-a/tests/${params.id}/questions`).get()).docs.map((d) => d.id);
      return { params, body: { ids } };
    },
  },
  'POST /v1/tests/:id/questions/import': {
    foreignParams: { id: 'test-org-b' },
    fresh: async (db) => ({ ...(await withTest(db)), body: { questions: [questionBody] } }),
  },
  'POST /v1/tests/:id/question-images': {
    foreignParams: { id: 'test-org-b' },
    fresh: async (db) => ({
      ...(await withTest(db)),
      body: {
        contentType: 'image/png',
        data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      },
    }),
  },

  'PUT /v1/students/:id/accommodations/:seriesId': {
    foreignParams: { id: 'stu-org-b-01', seriesId: 'series-org-b' },
    body: { extraPct: 10 },
    fresh: async (db) => ({ params: { id: 'stu-org-a-01', seriesId: await seriesIn(db, 'org-a', 'series-org-a') } }),
  },
  'DELETE /v1/students/:id/accommodations/:seriesId': {
    foreignParams: { id: 'stu-org-b-01', seriesId: 'series-org-b' },
    fresh: async (db) => {
      const seriesId = await seriesIn(db, 'org-a', 'series-org-a');
      await db
        .doc('organizations/org-a/students/stu-org-a-01')
        .update({ [`accommodations.${seriesId}`]: { extraMin: 5 } });
      return { params: { id: 'stu-org-a-01', seriesId } };
    },
  },

  'GET /v1/attempts/:id/events': { foreignParams: { id: 'att-org-b' }, fresh: withAttempt },
  'GET /v1/attempts/:id/audio-proof/:clipId': {
    foreignParams: { id: 'att-org-b', clipId: 'clip-12345678' },
    fresh: async (db) => ({ params: { ...(await withAttempt(db)).params, clipId: 'clip-12345678' } }),
  },
  'POST /v1/attempts/:id/extra-time': { foreignParams: { id: 'att-org-b' }, fresh: withTimedAttempt },
  'POST /v1/attempts/:id/terminate': { foreignParams: { id: 'att-org-b' }, fresh: withActionAttempt('in_progress') },
  'POST /v1/attempts/:id/reinstate': { foreignParams: { id: 'att-org-b' }, fresh: withActionAttempt('terminated') },
  'POST /v1/attempts/:id/reset': { foreignParams: { id: 'att-org-b' }, fresh: withActionAttempt('submitted') },

  'GET /v1/live-tests': { fresh: (db) => withPublishedTest(db) },
  'GET /v1/tests/:id/live': { foreignParams: { id: 'test-org-b' }, fresh: (db) => withPublishedTest(db) },
  'GET /v1/admin/diagnose/tests/:id': { foreignParams: { id: 'test-org-b' }, fresh: (db) => withPublishedTest(db) },
  'POST /v1/admin/assistant/chat': { body: {} },
  'POST /v1/admin/assistant/apply-action': { body: {} },
  'GET /v1/tests/:id/attempts': { foreignParams: { id: 'test-org-b' }, fresh: (db) => withPublishedTest(db) },

  'GET /v1/audit': {},

  // Reports (phase 7): the route-table tests turn `analytics_reports` on for both orgs first (it is off by default).
  'POST /v1/reports': {
    fresh: async (db) => {
      const { params } = await withPublishedTest(db);
      await db
        .doc('organizations/org-a/attempts/att-report-org-a')
        .set({ orgId: 'org-a', testId: params.id, status: 'submitted' });
      return { body: { scope: 'test', refId: params.id } };
    },
  },
  'GET /v1/reports': {},
  'GET /v1/reports/usage': {},
  'GET /v1/reports/:id': {
    params: { id: 'report-org-a' },
    foreignParams: { id: 'report-org-b' },
    fresh: async (db) => {
      for (const orgId of ['org-a', 'org-b'])
        await db.doc(`organizations/${orgId}/reports/report-${orgId}`).set({
          orgId,
          scope: 'test',
          refId: `test-${orgId}`,
          title: `Test test-${orgId}`,
          status: 'queued',
          includeXlsx: false,
          createdBy: 'seed',
          createdByName: 'Seed',
          createdAt: 0,
        });
      return { params: { id: 'report-org-a' } };
    },
  },
};

export const fillPath = (url: string, params: Record<string, string> = {}) =>
  url.replace(/:(\w+)/g, (_, k: string) => {
    if (!(k in params)) throw new Error(`no sample value for :${k} in ${url}`);
    return encodeURIComponent(params[k]!);
  });
