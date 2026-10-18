import {
  createdIdSchema,
  dayLabels,
  eligibilityPreviewRequestSchema,
  eligibilityPreviewResponseSchema,
  FULL_REVIEW_BEFORE_CLOSE_MESSAGE,
  resolveSettings,
  settingsProblems,
  drawProblems,
  testCreateSchema,
  testDetailSchema,
  testListQuerySchema,
  testListSchema,
  testPatchSchema,
  testDrawPools,
  testStatusAt,
  RELEASE_SETTING_KEYS,
  type DrawProblem,
  type Section,
  type Settings,
  type TestPatch,
  type Test,
  type TestDetail,
} from '@mitaoe/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { QuestionRecord } from '../data/questions';
import type { SeriesRecord } from '../data/series';
import { BACK_TO_REVIEW, type TestRecord, type TestUpdate } from '../data/tests';
import { AppError, notFound } from '../errors';
import { attemptsStarted, returnsToReview, testLocked } from '../services/test-review';
import type { ApiContext } from './context';

const admin = { access: 'admin' as const };
const idParams = z.object({ id: z.string().min(1).max(128) });
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

/** TST-01: a test's date lies within its series' dates. */
function refuseDateOutside(series: SeriesRecord, date: string): void {
  if (date < series.startDate || date > series.endDate)
    throw new AppError(
      400,
      'DATE_OUTSIDE_SERIES',
      `Choose a date from ${day(series.startDate)} to ${day(series.endDate)}, the series dates.`,
      { field: 'scheduledDate' },
    );
}

const questionsText = (n: number, what = 'approved') => `${n} ${what} ${n === 1 ? 'question' : 'questions'}`;

/** US-AD-07, Q-05: a draw its pool cannot satisfy, as the error the editor shows on the named field. */
function drawRefusal(p: DrawProblem): AppError {
  const holder = p.sectionId === null ? 'This test' : 'This section';
  const where = { sectionId: p.sectionId, problem: p.code };
  if (p.code === 'DRAW_TOO_LARGE')
    return new AppError(
      400,
      'DRAW_TOO_LARGE',
      `${holder} has ${questionsText(p.available)}, so it can't draw ${p.drawCount}.`,
      { ...where, field: 'drawCount', drawCount: p.drawCount, available: p.available },
    );
  if (p.code === 'MIX_UNSATISFIABLE')
    return new AppError(
      400,
      'MIX_UNSATISFIABLE',
      `${holder} has ${questionsText(p.available, p.difficulty)}, so the mix can't take ${p.wanted}.`,
      { ...where, field: `difficultyMix.${p.difficulty}`, wanted: p.wanted, available: p.available },
    );
  return new AppError(
    400,
    'MIX_UNSATISFIABLE',
    `The mix adds up to ${p.mixTotal} questions. Set Questions to draw to ${p.mixTotal} or leave it empty.`,
    { ...where, field: 'drawCount', mixTotal: p.mixTotal, drawCount: p.drawCount },
  );
}

const sameDraw = (a: Section | undefined, b: Section) =>
  !!a &&
  a.drawCount === b.drawCount &&
  (['easy', 'medium', 'hard'] as const).every((d) => a.difficultyMix?.[d] === b.difficultyMix?.[d]);

/**
 * Q-03, Q-05, US-AD-07: refuses a draw or difficulty mix this change sets that its pool of approved questions cannot
 * satisfy. Pools the change leaves as they were are not judged again. Questions of a section that is no longer listed
 * count as questions in no section.
 */
function refuseUnsatisfiableDraw(
  before: { sections: Section[] },
  next: { sections: Section[]; drawCount?: number },
  setsDrawCount: boolean,
  questions: QuestionRecord[],
): void {
  const previous = new Map(before.sections.map((s) => [s.id, s]));
  const listed = new Set(next.sections.map((s) => s.id));
  const pools = testDrawPools(
    next,
    questions.map((q) => (q.sectionId && !listed.has(q.sectionId) ? { ...q, sectionId: null } : q)),
  );
  for (const pool of pools) {
    const section = next.sections.find((s) => s.id === pool.sectionId);
    const judged = section ? !sameDraw(previous.get(section.id), section) : next.sections.length === 0 && setsDrawCount;
    const [problem] = judged ? drawProblems(pool) : [];
    if (problem) throw drawRefusal(problem);
  }
}

/** The same value, whatever the key order of the objects in it. */
const same = (a: unknown, b: unknown): boolean => {
  const sorted = (v: unknown): unknown =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, x]) => x !== undefined)
            .sort(([x], [y]) => x.localeCompare(y))
            .map(([k, x]) => [k, sorted(x)]),
        )
      : Array.isArray(v)
        ? v.map(sorted)
        : v;
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
};

const RELEASE_KEYS = new Set<string>(RELEASE_SETTING_KEYS);
const releaseOf = (s: Settings) => Object.fromEntries(RELEASE_SETTING_KEYS.map((k) => [k, s[k]]));

/**
 * Q-15, DECISIONS Q16: whether a PATCH changes what approval checked: sections, the draw, the date (and so the
 * window) or any setting but the five release and visibility ones. Details and eligibility (SER-08) do not.
 */
function lockedChange(before: TestRecord, body: TestPatch, sections: Section[] | undefined): boolean {
  const { overrides } = body;
  const keys = new Set([...Object.keys(before.overrides), ...Object.keys(overrides ?? {})]);
  const settingChanged =
    !!overrides &&
    [...keys].some(
      (k) => !RELEASE_KEYS.has(k) && !same(before.overrides[k as keyof Settings], overrides[k as keyof Settings]),
    );
  return (
    settingChanged ||
    (!!sections && !same(before.sections, sections)) ||
    ('drawCount' in body && (body.drawCount ?? undefined) !== before.drawCount) ||
    (!!body.scheduledDate && body.scheduledDate !== before.scheduledDate)
  );
}

/**
 * TST-06: once an attempt has started, the first locked field this PATCH would change: any setting override but the
 * five release and visibility keys, the window unless a flexible window only ends later, the sections, the draw or
 * the date. A series window edited since publishing does not count: the test's snapshot keeps its own. Null when
 * the change may be saved.
 */
function lockedAfterStart(
  before: TestRecord,
  body: TestPatch,
  sections: Section[] | undefined,
  windows: { before: Settings['window']; after: Settings['window'] | undefined; flexible: boolean },
): string | null {
  const { overrides } = body;
  if (overrides) {
    const keys = new Set([...Object.keys(before.overrides), ...Object.keys(overrides)]);
    for (const k of keys)
      if (!RELEASE_KEYS.has(k) && k !== 'window')
        if (!same(before.overrides[k as keyof Settings], overrides[k as keyof Settings])) return k;
    const [a, b] = [windows.before, windows.after];
    const extended = windows.flexible && !!a && !!b && b.start === a.start && b.end > a.end;
    const windowEdited = !same(before.overrides.window, overrides.window) && !same(a, b);
    if (windowEdited && !extended) return 'window';
  }
  if (sections && !same(before.sections, sections)) return 'sections';
  if ('drawCount' in body && (body.drawCount ?? undefined) !== before.drawCount) return 'drawCount';
  if (body.scheduledDate && body.scheduledDate !== before.scheduledDate) return 'scheduledDate';
  return null;
}

/** Tests of a series with their day labels and status (TST-01, TST-02, TST-04, TST-07, SER-03). */
export function testsRoutes(ctx: ApiContext): FastifyPluginAsyncZod {
  const { data, audit, clock, eligibility } = ctx;
  const db = ctx.firebase.db;
  const timezone = async (orgId: string) => (await data.orgs.getOrg(orgId))?.timezone ?? 'Asia/Kolkata';
  const settingsOf = (series: SeriesRecord, test: TestRecord, tz: string) =>
    test.resolved ?? resolveSettings({ series, test, timezone: tz });
  /** The test as shown: day label from the series' schedule order, status from the window and the Clock. */
  const view = (test: TestRecord, labels: Record<string, string | null>, series: SeriesRecord, tz: string): Test => ({
    ...test,
    dayLabel: labels[test.id] ?? null,
    status: testStatusAt(test.status, settingsOf(series, test, tz).window, clock.now()),
  });
  const series = async (orgId: string, seriesId: string) => {
    const s = await data.series.getSeries(orgId, seriesId);
    if (!s) throw notFound('Series');
    return s;
  };
  const detail = async (orgId: string, testId: string): Promise<TestDetail> => {
    const test = await data.tests.getTest(orgId, testId);
    if (!test) throw notFound('Test');
    const [s, tz, siblings] = await Promise.all([
      series(orgId, test.seriesId),
      timezone(orgId),
      data.tests.listTests(orgId, test.seriesId),
    ]);
    return { ...view(test, dayLabels(siblings), s, tz), effective: settingsOf(s, test, tz) };
  };

  return async (app) => {
    app.get(
      '/v1/tests',
      { config: admin, schema: { querystring: testListQuerySchema, response: { 200: testListSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const s = await series(orgId, req.query.seriesId);
        const [tests, tz] = await Promise.all([data.tests.listTests(orgId, s.id), timezone(orgId)]);
        const labels = dayLabels(tests);
        return { items: tests.map((t) => view(t, labels, s, tz)) };
      },
    );

    app.post(
      '/v1/tests',
      { config: admin, schema: { body: testCreateSchema, response: { 201: createdIdSchema } } },
      async (req, reply) => {
        const orgId = req.orgId!;
        const s = await series(orgId, req.body.seriesId);
        refuseDateOutside(s, req.body.scheduledDate);
        const input = { ...req.body, company: req.body.company || undefined, dayNumber: req.body.dayNumber || null };
        const batch = db.batch();
        const id = data.tests.createTest(orgId, batch, input, clock.now());
        audit(req, batch, { action: 'test.create', target: { type: 'test', id }, after: req.body });
        await batch.commit();
        return reply.status(201).send({ id });
      },
    );

    app.get(
      '/v1/tests/:id',
      { config: admin, schema: { params: idParams, response: { 200: testDetailSchema } } },
      async (req) => detail(req.orgId!, req.params.id),
    );

    app.patch(
      '/v1/tests/:id',
      { config: admin, schema: { params: idParams, body: testPatchSchema, response: { 200: testDetailSchema } } },
      async (req) => {
        const orgId = req.orgId!;
        const before = await data.tests.getTest(orgId, req.params.id);
        if (!before) throw notFound('Test');
        const s = await series(orgId, before.seriesId);
        const { overrides, sections, ...details } = req.body;
        if (details.scheduledDate) refuseDateOutside(s, details.scheduledDate);
        const tz = await timezone(orgId);
        const fresh = overrides
          ? resolveSettings({
              series: s,
              test: { overrides, scheduledDate: details.scheduledDate ?? before.scheduledDate },
              timezone: tz,
            })
          : undefined;
        const started = await attemptsStarted(data, orgId, before);
        const current = settingsOf(s, before, tz);
        const extendsWindow =
          started &&
          !!fresh &&
          !same(before.overrides.window, overrides?.window) &&
          !same(current.window, fresh.window);
        if (fresh && settingsProblems(fresh).length)
          throw new AppError(400, 'FULL_REVIEW_BEFORE_CLOSE', FULL_REVIEW_BEFORE_CLOSE_MESSAGE, {
            field: 'resultRelease',
          });
        const nextSections = sections?.map((x, i) => ({
          ...x,
          id: x.id ?? data.tests.newSectionId(orgId),
          order: i + 1,
        }));
        if (started) {
          const windows = { before: current.window, after: fresh?.window, flexible: fresh?.timingMode === 'flexible' };
          const field = lockedAfterStart(before, req.body, nextSections, windows);
          if (field) throw testLocked('settings', field);
        }
        // Draw checks (US-AD-07); a deleted section's questions move to no section (DECISIONS).
        let orphaned: string[] = [];
        if (nextSections || details.drawCount != null) {
          const questions = await data.questions.listQuestions(orgId, before.id);
          const next = {
            sections: nextSections ?? before.sections,
            drawCount: 'drawCount' in details ? (details.drawCount ?? undefined) : before.drawCount,
          };
          refuseUnsatisfiableDraw(before, next, details.drawCount != null, questions);
          const listed = new Set(next.sections.map((x) => x.id));
          orphaned = questions.filter((q) => q.sectionId && !listed.has(q.sectionId)).map((q) => q.id);
        }
        const now = clock.now();
        const review = lockedChange(before, req.body, nextSections) && returnsToReview(before, started);
        // SER-09: a snapshot updated in place keeps its own timing, so the merged snapshot is what must not leak.
        // TST-06: after a start, a flexible window's later end goes into the snapshot too.
        const snapshot =
          !review && fresh && before.resolved
            ? { ...before.resolved, ...releaseOf(fresh), ...(extendsWindow ? { window: fresh.window } : {}) }
            : undefined;
        if (snapshot && settingsProblems(snapshot).length)
          throw new AppError(400, 'FULL_REVIEW_BEFORE_CLOSE', FULL_REVIEW_BEFORE_CLOSE_MESSAGE, {
            field: 'resultRelease',
          });
        const changes: TestUpdate = {
          ...details,
          ...('company' in details ? { company: details.company || null } : {}),
          ...('dayNumber' in details ? { dayNumber: details.dayNumber || null } : {}),
          ...(overrides ? { overrides } : {}),
          ...(nextSections ? { sections: nextSections } : {}),
          // Q-15: back to review, or a release and visibility change written into the snapshot in place.
          ...(review ? BACK_TO_REVIEW : {}),
          ...(snapshot ? { resolved: snapshot } : {}),
          updatedAt: now,
        };
        const batch = db.batch();
        data.tests.updateTest(orgId, batch, before.id, changes);
        if (orphaned.length) {
          data.questions.clearSection(orgId, batch, before.id, orphaned, now);
          data.tests.questionsChanged(orgId, batch, before.id, now);
        }
        const target = { type: 'test', id: before.id };
        if (overrides)
          audit(req, batch, { action: 'test.settings.update', target, before: before.overrides, after: overrides });
        const rest = Object.keys(req.body).filter((k) => k !== 'overrides') as Array<keyof TestRecord>;
        if (rest.length)
          audit(req, batch, {
            action: 'test.update',
            target,
            before: Object.fromEntries(rest.map((k) => [k, before[k] ?? null])),
            after: Object.fromEntries(rest.map((k) => [k, changes[k as keyof TestUpdate] ?? null])),
          });
        await batch.commit();
        return detail(orgId, before.id);
      },
    );

    // SER-06, SER-07: the live count for a test's rules, applied on top of its series' stored rules.
    app.post(
      '/v1/tests/:id/eligibility/preview',
      {
        config: admin,
        schema: {
          params: idParams,
          body: eligibilityPreviewRequestSchema,
          response: { 200: eligibilityPreviewResponseSchema },
        },
      },
      async (req) => {
        const orgId = req.orgId!;
        const test = await data.tests.getTest(orgId, req.params.id);
        if (!test) throw notFound('Test');
        const s = await series(orgId, test.seriesId);
        const students = await eligibility.matchingStudents(orgId, s.eligibility, req.body.eligibility);
        return { count: students.length, students };
      },
    );
  };
}
