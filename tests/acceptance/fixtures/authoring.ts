import { writeFile } from 'node:fs/promises';
import { expect } from '@playwright/test';
import type { Emulators, StoredDoc } from './emulators';

// Phase 2 authoring facts and stored-state reads (docs/testids/phase-2.md). Seeds are created through the test-only
// API (fixtures/test-api.ts); these helpers only read what the system stored.

/** The test clock every phase 2 test starts from: 20 Oct 2026, 06:00 UTC (11:30 IST). */
export const AUTHORING_NOW = Date.UTC(2026, 9, 20, 6, 0);

/** Epoch ms of a wall-clock time in IST (Asia/Kolkata, UTC+05:30, no daylight saving). */
export const istMs = (y: number, month: number, day: number, hh: number, mm = 0) =>
  Date.UTC(y, month - 1, day, hh, mm) - 330 * 60_000;

/** The series made by the `authoring-series` scenario. */
export const SEEDED_SERIES = {
  title: 'Placement 2026',
  description: 'Daily tests for the 2026 placement season.',
  startDate: '2026-11-01',
  endDate: '2026-11-30',
  dates: '1 Nov 2026 to 30 Nov 2026',
  dailyWindow: '10:00 to 11:00 IST',
} as const;

/** The test made by the `authoring-test` scenario, the only test of its series (so `Day 1`). */
export const SEEDED_TEST = {
  title: 'Quantitative aptitude',
  company: 'TCS',
  scheduledDate: '2026-11-02',
  heading: 'Day 1: Quantitative aptitude',
  schedule: 'Scheduled 2 Nov 2026, 10:00 to 11:00 IST',
  windowStart: istMs(2026, 11, 2, 10),
  windowEnd: istMs(2026, 11, 2, 11),
} as const;

/** System defaults (spec 5.4) under PLAN `Settings` keys, as the scenario seeds them on a series. */
export const SYSTEM_DEFAULTS = {
  timingMode: 'fixed',
  durationMin: 60,
  lateEntryCutoffMin: 15,
  windowEndPolicy: 'full_duration',
  maxStrikes: 3,
  devtoolsPolicy: 'block_strike',
  fullscreenRequired: true,
  cameraRequired: true,
  secondCamera: false,
  shuffleQuestions: true,
  shuffleOptions: true,
  resultRelease: 'after_close',
  resultDetail: 'sections',
  showPastScores: true,
  testLeaderboard: false,
  seriesLeaderboard: false,
} as const;

export interface KnownQuestion {
  prompt: string;
  options: readonly string[];
  /** Index of the correct option, or null for none. */
  correct: number | null;
  explanation?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
}

/** The `basic` question set, in order. */
export const BASIC_QUESTIONS: readonly KnownQuestion[] = [
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

/** Question 5 added by `invalidQuestion: true`: no correct answer, so `draft`. */
export const INVALID_QUESTION: KnownQuestion = {
  prompt: 'Which of these is a prime number?',
  options: ['21', '23', '25', '27'],
  correct: null,
};

/** Prompts of the `sectioned` set, in order. */
export const SECTIONED_PROMPTS = {
  Quant: ['Quant easy 1', 'Quant easy 2', 'Quant easy 3', 'Quant medium 1', 'Quant medium 2', 'Quant hard 1'],
  Verbal: ['Verbal easy 1', 'Verbal easy 2', 'Verbal medium 1', 'Verbal medium 2'],
} as const;

export const letter = (i: number) => String.fromCharCode(65 + i);

/** The exam screen's radio name for option i of a question (`A. 20 m/s`). */
export const optionName = (q: KnownQuestion, i: number) => `${letter(i)}. ${q.options[i]}`;

/** Question-check reason texts (docs/testids/phase-2.md, "Question checks"). */
export const REASONS = {
  noCorrect: 'No correct answer is set.',
  tooFewOptions: 'A question needs at least two options.',
  emptyPrompt: 'The question text is empty.',
  multipleCorrect: 'More than one option is marked correct.',
  noAlt: (n: number) => `Image ${n} has no alt text.`,
} as const;

/** Records of the org's `collectionId` collection with `field` equal to `value`. */
const orgWhere = (e: Emulators, orgId: string, collectionId: string, field: string, value: string) =>
  e.where(`organizations/${orgId}`, collectionId, field, value);

/** The one series of this org with this title; fails if there is not exactly one. */
export async function seriesByTitle(e: Emulators, orgId: string, title: string): Promise<StoredDoc> {
  const found = await orgWhere(e, orgId, 'series', 'title', title);
  expect(found, `series titled ${title} in ${orgId}`).toHaveLength(1);
  return found[0]!;
}

/** The one test of this org with this title; fails if there is not exactly one. */
export async function testByTitle(e: Emulators, orgId: string, title: string): Promise<StoredDoc> {
  const found = await orgWhere(e, orgId, 'tests', 'title', title);
  expect(found, `tests titled ${title} in ${orgId}`).toHaveLength(1);
  return found[0]!;
}

/** The stored test record (organizations/{orgId}/tests/{testId}); fails if it is missing. */
export async function storedTest(e: Emulators, orgId: string, testId: string): Promise<Record<string, unknown>> {
  const doc = await e.doc(`organizations/${orgId}/tests/${testId}`);
  expect(doc, `test ${testId} in ${orgId}`).not.toBeNull();
  return doc!.data;
}

/** The stored series record; fails if it is missing. */
export async function storedSeries(e: Emulators, orgId: string, seriesId: string): Promise<Record<string, unknown>> {
  const doc = await e.doc(`organizations/${orgId}/series/${seriesId}`);
  expect(doc, `series ${seriesId} in ${orgId}`).not.toBeNull();
  return doc!.data;
}

/** Tests of a series, as stored. */
export async function testsOfSeries(e: Emulators, orgId: string, seriesId: string): Promise<StoredDoc[]> {
  return orgWhere(e, orgId, 'tests', 'seriesId', seriesId);
}

/** The questions of a test as stored, sorted by their `order` field. */
export async function questionsOf(e: Emulators, orgId: string, testId: string): Promise<StoredDoc[]> {
  const docs = await e.list(`organizations/${orgId}/tests/${testId}`, 'questions');
  return docs.sort((a, b) => Number(a.data.order) - Number(b.data.order));
}

/** Prompts of a test's stored questions in `order`. */
export async function storedPrompts(e: Emulators, orgId: string, testId: string): Promise<string[]> {
  return (await questionsOf(e, orgId, testId)).map((q) => String(q.data.prompt));
}

/** The text of the stored option a stored question marks correct (single-answer questions). */
export function correctOptionText(q: StoredDoc): string | undefined {
  const options = (q.data.options as Array<{ id: string; text: string }> | undefined) ?? [];
  const correct = (q.data.correctOptionIds as string[] | undefined) ?? [];
  return options.find((o) => correct.includes(o.id))?.text;
}

/** Audit entries of an org for this action whose target is this ID. */
export async function auditFor(e: Emulators, orgId: string, action: string, targetId?: string): Promise<StoredDoc[]> {
  const entries = await e.audit(orgId, action);
  return targetId === undefined
    ? entries
    : entries.filter((d) => (d.data.target as { id?: string } | undefined)?.id === targetId);
}

export interface JsonQuestion {
  prompt: string;
  options: string[];
  correct?: string | string[];
  explanation?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  marks?: number;
  negativeMarks?: number;
  tags?: string[];
  timeLimitSec?: number;
}

/** Writes a question file in the `mitaoe-questions/1` import format and returns its path. */
export async function writeQuestionsJson(path: string, questions: JsonQuestion[]): Promise<string> {
  await writeFile(path, JSON.stringify({ format: 'mitaoe-questions/1', questions }, null, 2), 'utf8');
  return path;
}

/** A question in the legacy JSON format (spec 15.1; legacy/data/infosys/infosys-set-2.json). */
export interface LegacyJsonQuestion {
  id: string;
  text: string;
  options: string[];
  /** 0-based index of the correct option. */
  correctIndex?: number;
  explanation?: string;
  topic?: string;
  source?: string;
}

/** Writes a question file in the legacy format (no `format` key) and returns its path. */
export async function writeLegacyQuestionsJson(path: string, questions: LegacyJsonQuestion[]): Promise<string> {
  await writeFile(path, JSON.stringify({ questions }, null, 2), 'utf8');
  return path;
}
