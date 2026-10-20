import {
  NO_RESTRICTION,
  resolveSettings,
  SYSTEM_DEFAULTS,
  testDrawPools,
  totalMarks as totalMarksOf,
  type Difficulty,
  type Section,
  type Settings,
  type TaskQueue,
} from '@mitaoe/shared';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { AppError } from '../errors';
import { queuePublishTasks } from '../services/publish-tasks';
import { emailKey, SEED_ORGS, writeSeedStudent } from './seed';

// Scenario data on top of the base seed for acceptance tests (POST /__test/seed/:scenario, docs/testids).

export type ScenarioResult = Record<string, string | string[] | Record<string, string> | Record<string, number>>;
/** `queue` is the API's task queue, for scenarios that queue what the real action would (publishing, RES-01). */
type Scenario = (
  db: Firestore,
  now: number,
  body: Record<string, unknown>,
  queue?: TaskQueue,
) => Promise<ScenarioResult>;

const emptyOrg: Scenario = async (db, now) => {
  const batch = db.batch();
  const org = db.doc('organizations/org-c');
  batch.set(org, {
    orgId: 'org-c',
    name: 'Empty College of Engineering',
    slug: 'empty',
    status: 'active',
    timezone: 'Asia/Kolkata',
    logoPath: null,
    planId: 'standard',
    featureOverrides: {},
    limitOverrides: {},
    profileLocked: false,
    createdAt: now,
  });
  batch.set(org.collection('admins').doc('adm-org-c-1'), {
    orgId: 'org-c',
    email: 'admin1@c.test',
    name: 'Admin 1',
    uid: null,
    status: 'active',
    addedBy: 'seed',
    addedAt: now,
  });
  batch.set(db.doc(`emailIndex/${emailKey('admin1@c.test')}`), { orgIds: ['org-c'] });
  await batch.commit();
  return { orgId: 'org-c' };
};

/** A closed test with one graded attempt by the student: 42 of 50, one strike. */
const studentAttempts: Scenario = async (db, now, body) => {
  const orgId = String(body.orgId ?? '');
  const studentId = String(body.studentId ?? '');
  const student = await db.doc(`organizations/${orgId}/students/${studentId}`).get();
  if (!student.exists) throw new AppError(404, 'NOT_FOUND', 'No such student for the scenario.');
  const org = db.doc(`organizations/${orgId}`);
  const series = org.collection('series').doc();
  const test = org.collection('tests').doc();
  const attempt = org.collection('attempts').doc();
  const batch = db.batch();
  batch.set(series, {
    orgId,
    title: 'Placement 2026',
    status: 'active',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    defaults: {},
    eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
  });
  batch.set(test, {
    orgId,
    seriesId: series.id,
    title: 'Day 1: Aptitude',
    status: 'closed',
    scheduledDate: '2026-10-10',
    overrides: {},
    sections: [],
    questionSetVersion: 1,
    totalMarks: 50,
  });
  batch.set(attempt, {
    orgId,
    testId: test.id,
    seriesId: series.id,
    studentId,
    uid: student.get('uid') ?? null,
    status: 'submitted',
    startedAt: now - 3_600_000,
    deadlineAt: now - 60_000,
    submittedAt: now - 120_000,
    extraTimeSec: 0,
    strikesCount: 1,
    result: { score: 42, max: 50, pct: 84, sections: {}, correct: 42, incorrect: 5, unanswered: 3, durationSec: 3480 },
  });
  await batch.commit();
  return { seriesId: series.id, testId: test.id, attemptId: attempt.id };
};

/** The settings of the spec 5.4 table, at their system defaults, as a seeded series holds them. */
const { marking: _m, floorAtZero: _f, questionTimeMode: _q, ...TABLE_DEFAULTS } = SYSTEM_DEFAULTS;

/** Phase 2: a series (docs/testids/phase-2.md, `authoring-series`). Seeds write directly, with no audit entry. */
const authoringSeries: Scenario = async (db, now, body) => {
  const orgId = String(body.orgId ?? '');
  if (!(await db.doc(`organizations/${orgId}`).get()).exists)
    throw new AppError(404, 'NOT_FOUND', 'No such organization for the scenario.');
  const ref = db.collection(`organizations/${orgId}/series`).doc();
  await ref.set({
    orgId,
    title: typeof body.title === 'string' ? body.title : 'Placement 2026',
    description: 'Daily tests for the 2026 placement season.',
    status: typeof body.status === 'string' ? body.status : 'draft',
    startDate: '2026-11-01',
    endDate: '2026-11-30',
    dailyWindow: { startMinutes: 600, endMinutes: 660 },
    defaults: { ...TABLE_DEFAULTS, ...(body.defaults as object | undefined) },
    eligibility: { ...NO_RESTRICTION, ...(body.eligibility as object | undefined) },
    createdAt: now,
    updatedAt: now,
  });
  return { seriesId: ref.id };
};

interface SeedQuestion {
  prompt: string;
  options: string[];
  correct: number | null;
  explanation?: string;
  difficulty?: Difficulty;
  section?: string;
}

/** The `basic` set (docs/testids/phase-2.md): approved, no section, no marks of their own. */
const BASIC: SeedQuestion[] = [
  {
    prompt: 'A train 240 m long passes a pole in 12 seconds. What is its speed?',
    options: ['20 m/s', '24 m/s', '18 m/s', '22 m/s'],
    correct: 0,
    explanation: 'Speed is distance over time: 240 / 12 = 20 m/s.',
    difficulty: 'easy',
  },
  {
    prompt: 'What is 15% of 200?',
    options: ['25', '30', '35', '40'],
    correct: 1,
    explanation: '15 / 100 × 200 = 30.',
    difficulty: 'medium',
  },
  { prompt: 'If $x + 3 = 7$, what is $x$?', options: ['3', '4', '5', '7'], correct: 1, difficulty: 'easy' },
  {
    prompt: 'Which number comes next: 2, 4, 8, 16?',
    options: ['24', '30', '32', '64'],
    correct: 2,
    explanation: 'Each number doubles: 16 × 2 = 32.',
    difficulty: 'hard',
  },
];
const INVALID: SeedQuestion = {
  prompt: 'Which of these is a prime number?',
  options: ['21', '23', '25', '27'],
  correct: null,
};
const SECTIONS = [
  { name: 'Quant', instructions: 'Answer every question. Calculators are not allowed.' },
  { name: 'Verbal', instructions: 'Read each passage carefully.' },
];
const sectioned = (): SeedQuestion[] =>
  (
    [
      ['Quant', 'easy', 3],
      ['Quant', 'medium', 2],
      ['Quant', 'hard', 1],
      ['Verbal', 'easy', 2],
      ['Verbal', 'medium', 2],
    ] as const
  ).flatMap(([section, difficulty, n]) =>
    Array.from({ length: n }, (_, i) => {
      const prompt = `${section} ${difficulty} ${i + 1}`;
      const options = ['Option one', 'Option two', 'Option three', 'Option four'];
      return { prompt, options, correct: 0, explanation: `Explanation for ${prompt}.`, difficulty, section };
    }),
  );

/**
 * Phase 2: a test with a question set (docs/testids/phase-2.md, `authoring-test`), in a new default series unless
 * `seriesId` is given. `publish: true` stores it approved and scheduled with its settings snapshot.
 */
const authoringTest: Scenario = async (db, now, body, queue) => {
  const orgId = String(body.orgId ?? '');
  const seriesId =
    typeof body.seriesId === 'string' ? body.seriesId : String((await authoringSeries(db, now, { orgId })).seriesId);
  const [org, series] = await Promise.all([
    db.doc(`organizations/${orgId}`).get(),
    db.doc(`organizations/${orgId}/series/${seriesId}`).get(),
  ]);
  if (!org.exists || !series.exists) throw new AppError(404, 'NOT_FOUND', 'No such series for the scenario.');
  const set = body.questions === 'none' || body.questions === 'sectioned' ? body.questions : 'basic';
  const questions = set === 'none' ? [] : set === 'basic' ? [...BASIC] : sectioned();
  if (body.invalidQuestion === true) questions.push(INVALID);
  const ref = db.collection(`organizations/${orgId}/tests`).doc();
  const draws = (body.sectionDraws ?? {}) as Record<string, number>;
  const sections: Section[] =
    set === 'sectioned'
      ? SECTIONS.map((s, i) => ({
          id: ref.collection('sections').doc().id,
          ...s,
          order: i + 1,
          forwardOnly: false,
          ...(draws[s.name] !== undefined ? { drawCount: draws[s.name] } : {}),
        }))
      : [];
  const sectionIds = Object.fromEntries(sections.map((s) => [s.name, s.id]));
  const overrides = (body.overrides ?? {}) as Record<string, unknown>;
  const scheduledDate = typeof body.scheduledDate === 'string' ? body.scheduledDate : '2026-11-02';
  // Seeded in order on a frozen clock, a later test of the series is still created later, so day order (TST-02)
  // follows seeding order instead of the random IDs.
  const siblings = await db.collection(`organizations/${orgId}/tests`).where('seriesId', '==', seriesId).get();
  const createdAt = Math.max(now, ...siblings.docs.map((d) => ((d.get('createdAt') as number | undefined) ?? 0) + 1));
  const batch = db.batch();
  const stored = questions.map((q, i) => {
    const qRef = ref.collection('questions').doc();
    const sectionId = q.section ? sectionIds[q.section] : undefined;
    const doc = {
      orgId,
      testId: ref.id,
      ...(sectionId ? { sectionId } : {}),
      order: i + 1,
      type: 'single',
      prompt: q.prompt,
      images: [],
      options: q.options.map((text, j) => ({ id: 'abcdef'[j]!, text })),
      correctOptionIds: q.correct === null ? [] : ['abcdef'[q.correct]!],
      ...(q.explanation ? { explanation: q.explanation } : {}),
      ...(q.difficulty ? { difficulty: q.difficulty } : {}),
      tags: [],
      source: { kind: 'manual' },
      status: q.correct === null ? 'draft' : 'approved',
      createdAt: now,
      updatedAt: now,
    };
    batch.set(qRef, doc);
    return { id: qRef.id, ...doc };
  });
  const test: Record<string, unknown> = {
    orgId,
    seriesId,
    title: typeof body.title === 'string' ? body.title : 'Quantitative aptitude',
    company: typeof body.company === 'string' ? body.company : 'TCS',
    dayHidden: false,
    scheduledDate,
    overrides,
    eligibility: NO_RESTRICTION,
    sections,
    ...(typeof body.testDraw === 'number' ? { drawCount: body.testDraw } : {}),
    status: questions.length ? 'in_review' : 'draft',
    questionSetVersion: 1,
    totalMarks: 0,
    attemptsStarted: false,
    createdAt,
    updatedAt: now,
  };
  if (body.publish === true) {
    const resolved = resolveSettings({
      series: { defaults: series.get('defaults') ?? {}, dailyWindow: series.get('dailyWindow') },
      test: { overrides, scheduledDate },
      timezone: org.get('timezone') ?? 'Asia/Kolkata',
    });
    const pools = testDrawPools({ sections, drawCount: test.drawCount as number | undefined }, stored);
    const { total: totalMarks } = totalMarksOf(pools, stored, sections, resolved.marking);
    Object.assign(test, {
      status: 'scheduled',
      approval: { status: 'approved', approvedBy: 'seed', approvedAt: now },
      resolved,
      totalMarks,
    });
  }
  batch.set(ref, test);
  await batch.commit();
  // As publishing does (RES-01, PERF-06): the release and pre-warm tasks, through the same code.
  const resolved = test.resolved as Pick<Settings, 'window'> | undefined;
  if (resolved && queue) await queuePublishTasks(queue, { orgId, testId: ref.id, settings: resolved, now });
  return { seriesId, testId: ref.id, questionIds: stored.map((q) => q.id), sectionIds };
};

const MIN = 60_000;
const DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** The calendar day (yyyy-mm-dd) of an instant in a timezone. */
const zonedDay = (ms: number, timeZone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);

/**
 * Phase 3: a published test ready to sit (docs/testids/phase-3.md, `exam-test`), its window `opensInMin` minutes
 * from the clock's current time, in a new active `Placement 2026` series unless `seriesId` is given. Proctoring that
 * needs hardware and shuffling are off unless `overrides` switch them on.
 */
const examTest: Scenario = async (db, now, body, queue) => {
  const orgId = String(body.orgId ?? '');
  const org = await db.doc(`organizations/${orgId}`).get();
  if (!org.exists) throw new AppError(404, 'NOT_FOUND', 'No such organization for the scenario.');
  const timezone = (org.get('timezone') as string | undefined) ?? 'Asia/Kolkata';
  const start = now + num(body.opensInMin, -2) * MIN;
  const window = { start, end: start + num(body.windowMin, 60) * MIN };
  const timingMode = body.timingMode === 'flexible' ? 'flexible' : 'fixed';
  const overrides = {
    window,
    timingMode,
    ...(timingMode === 'flexible' ? { durationMin: num(body.durationMin, 60) } : {}),
    fullscreenRequired: false,
    cameraRequired: false,
    secondCamera: false,
    shuffleQuestions: false,
    shuffleOptions: false,
    ...(body.overrides as object | undefined),
  };
  const scheduledDate = zonedDay(window.start, timezone);
  let seriesId = typeof body.seriesId === 'string' ? body.seriesId : null;
  if (!seriesId) {
    const ref = db.collection(`organizations/${orgId}/series`).doc();
    const day = Date.parse(`${scheduledDate}T00:00:00Z`);
    await ref.set({
      orgId,
      title: 'Placement 2026',
      description: 'Daily tests for the 2026 placement season.',
      status: typeof body.seriesStatus === 'string' ? body.seriesStatus : 'active',
      startDate: isoDay(day - 30 * DAY),
      endDate: isoDay(day + 60 * DAY),
      dailyWindow: { startMinutes: 600, endMinutes: 660 },
      defaults: { ...TABLE_DEFAULTS },
      eligibility: { ...NO_RESTRICTION, ...(body.seriesEligibility as object | undefined) },
      createdAt: now,
      updatedAt: now,
    });
    seriesId = ref.id;
  }
  const ids = await authoringTest(
    db,
    now,
    {
      orgId,
      seriesId,
      ...(typeof body.title === 'string' ? { title: body.title } : {}),
      ...(typeof body.company === 'string' ? { company: body.company } : {}),
      ...(body.questions !== undefined ? { questions: body.questions } : {}),
      ...(body.sectionDraws !== undefined ? { sectionDraws: body.sectionDraws } : {}),
      ...(body.testDraw !== undefined ? { testDraw: body.testDraw } : {}),
      overrides,
      scheduledDate,
      publish: body.publish !== false,
    },
    queue,
  );
  if (body.eligibility)
    await db
      .doc(`organizations/${orgId}/tests/${String(ids.testId)}`)
      .update({ eligibility: { ...NO_RESTRICTION, ...(body.eligibility as object) } });
  return { ...ids, window };
};

const ATTEMPT_ENDS = ['submitted', 'auto_submitted', 'terminated'];

/**
 * Phase 4: finished, graded attempts of a published test written directly (docs/testids/phase-4.md,
 * `graded-attempts`), with their attempt index entries; no answers, no audit entry, no leaderboard task.
 */
const gradedAttempts: Scenario = async (db, _now, body) => {
  const orgId = String(body.orgId ?? '');
  const testId = String(body.testId ?? '');
  const org = db.doc(`organizations/${orgId}`);
  const test = await org.collection('tests').doc(testId).get();
  const window = test.get('resolved.window') as { start: number; end: number } | null | undefined;
  if (!test.exists || !window) throw new AppError(404, 'NOT_FOUND', 'No such published test for the scenario.');
  const questions = (await test.ref.collection('questions').get()).docs
    .filter((d) => d.get('status') === 'approved')
    .sort((a, b) => (a.get('order') as number) - (b.get('order') as number));
  const questionIds = questions.map((q) => q.id);
  const bySection = new Map<string | null, string[]>();
  for (const q of questions) {
    const key = (q.get('sectionId') as string | undefined) ?? null;
    bySection.set(key, [...(bySection.get(key) ?? []), q.id]);
  }
  const draw = {
    questionIds,
    optionOrder: Object.fromEntries(
      questions.map((q) => [q.id, (q.get('options') as Array<{ id: string }>).map((o) => o.id)]),
    ),
    sections: [...bySection].map(([sectionId, ids]) => ({ sectionId, questionIds: ids })),
  };
  const max = (test.get('totalMarks') as number | undefined) ?? 0;
  const entries = Array.isArray(body.attempts) ? (body.attempts as Array<Record<string, unknown>>) : [];
  const batch = db.batch();
  const attemptIds = entries.map((e) => {
    const studentId = String(e.studentId ?? '');
    const status = ATTEMPT_ENDS.includes(String(e.status)) ? String(e.status) : 'submitted';
    const score = num(e.score, 0);
    const timeSec = num(e.timeSec, 0);
    const ref = org.collection('attempts').doc();
    batch.set(ref, {
      orgId,
      testId,
      seriesId: test.get('seriesId'),
      studentId,
      uid: null,
      status,
      startedAt: window.start,
      submittedAt: num(e.submittedAt, window.start + timeSec * 1000),
      deadlineAt: window.end,
      extraTimeSec: 0,
      strikesCount: num(e.strikesCount, 0),
      ...(status === 'terminated'
        ? { terminationReason: typeof e.terminationReason === 'string' ? e.terminationReason : 'max_strikes' }
        : {}),
      draw,
      questionServedAt: {},
      result: {
        score,
        max,
        pct: max ? (score / max) * 100 : 0,
        sections: {},
        correct: num(e.correct, 0),
        incorrect: num(e.incorrect, 0),
        unanswered: num(e.unanswered, 0),
        durationSec: timeSec,
      },
    });
    batch.set(org.collection('attemptIndex').doc(`${testId}_${studentId}`), {
      testId,
      studentId,
      activeAttemptId: ref.id,
      attemptCount: 1,
    });
    return ref.id;
  });
  batch.update(test.ref, { attemptsStarted: true });
  await batch.commit();
  return { attemptIds };
};

/**
 * Phase 4: registered students 21 to 20 + `count` of a seed org (docs/testids/phase-4.md, `more-students`), made
 * exactly like the base seed's 20, named `Student NN`. At most 79, so NN stays two digits.
 */
const moreStudents: Scenario = async (db, now, body) => {
  const org = SEED_ORGS.find((o) => o.id === body.orgId);
  if (!org || !(await db.doc(`organizations/${org.id}`).get()).exists)
    throw new AppError(404, 'NOT_FOUND', 'No such organization for the scenario.');
  const count = Math.min(Math.max(Math.floor(num(body.count, 0)), 0), 79);
  const batch = db.batch();
  const studentIds = Array.from({ length: count }, (_, k) => {
    const n = 21 + k;
    const nn = String(n).padStart(2, '0');
    const email = writeSeedStudent(batch, db, org, n, `Student ${nn}`, now);
    batch.set(db.doc(`emailIndex/${emailKey(email)}`), { orgIds: FieldValue.arrayUnion(org.id) }, { merge: true });
    return `stu-${org.id}-${nn}`;
  });
  await batch.commit();
  return { studentIds };
};

/**
 * Phase 8 (docs/testids/phase-8.md, `pre-migration-students`): removes the `accommodations` field from these student
 * records of the organization, the shape before phase 5, and writes nothing else. 404 when one does not exist.
 */
const preMigrationStudents: Scenario = async (db, _now, body) => {
  const orgId = String(body.orgId ?? '');
  const studentIds = Array.isArray(body.studentIds) ? body.studentIds.map(String) : [];
  const refs = studentIds.map((id) => db.doc(`organizations/${orgId}/students/${id}`));
  const found = refs.length ? await db.getAll(...refs) : [];
  if (!orgId || found.some((d) => !d.exists)) throw new AppError(404, 'NOT_FOUND', 'No such student for the scenario.');
  const batch = db.batch();
  for (const ref of refs) batch.update(ref, { accommodations: FieldValue.delete() });
  await batch.commit();
  return { studentIds };
};

export const SCENARIOS: Record<string, Scenario> = {
  'empty-org': emptyOrg,
  'student-attempts': studentAttempts,
  'authoring-series': authoringSeries,
  'authoring-test': authoringTest,
  'exam-test': examTest,
  'graded-attempts': gradedAttempts,
  'more-students': moreStudents,
  'pre-migration-students': preMigrationStudents,
};
