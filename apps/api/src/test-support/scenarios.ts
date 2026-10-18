import {
  NO_RESTRICTION,
  resolveSettings,
  SYSTEM_DEFAULTS,
  testDrawPools,
  totalMarks as totalMarksOf,
  type Difficulty,
  type Section,
} from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { AppError } from '../errors';
import { emailKey } from './seed';

// Scenario data on top of the base seed for acceptance tests (POST /__test/seed/:scenario, docs/testids).

export type ScenarioResult = Record<string, string | string[] | Record<string, string>>;
type Scenario = (db: Firestore, now: number, body: Record<string, unknown>) => Promise<ScenarioResult>;

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
const authoringTest: Scenario = async (db, now, body) => {
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
    createdAt: now,
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
  return { seriesId, testId: ref.id, questionIds: stored.map((q) => q.id), sectionIds };
};

export const SCENARIOS: Record<string, Scenario> = {
  'empty-org': emptyOrg,
  'student-attempts': studentAttempts,
  'authoring-series': authoringSeries,
  'authoring-test': authoringTest,
};
