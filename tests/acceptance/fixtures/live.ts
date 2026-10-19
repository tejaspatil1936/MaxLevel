import { readFile } from 'node:fs/promises';
import { expect, type APIRequestContext } from '@playwright/test';
import type { ApiClient, ApiResponse } from './api';
import type { Emulators, StoredDoc } from './emulators';
import { idempotency, istTime, remainingPattern, storedAttempt, timerText } from './exam';
import { WORKER_URL } from './results';
import type { Rtdb } from './rtdb';
import type { TestApi } from './test-api';

// Phase 5 live-operations facts, texts, API calls and stored-state reads (docs/testids/phase-5.md). Seeds come from
// the test-only API (`exam-test`, `authoring-series`, `authoring-test`); these helpers act through the real API and read
// what the system stored in Firestore and Realtime Database.

export const MIN = 60_000;
const two = (n: number) => String(n).padStart(2, '0');

// ---------- texts as people see them ----------

/** `HH:mm:ss` of an instant in IST. */
export function istTimeSeconds(ms: number): string {
  const d = new Date(ms + 330 * MIN);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:${two(d.getUTCSeconds())}`;
}

export interface LiveCounts {
  eligible: number;
  notStarted: number;
  pairing: number;
  inProgress: number;
  submitted: number;
  autoSubmitted: number;
  terminated: number;
}

const enIN = (n: number) => new Intl.NumberFormat('en-IN').format(n);

/** The seven `Status counts` items, in order. */
export const countTexts = (c: LiveCounts): string[] => [
  `${enIN(c.eligible)} eligible`,
  `${enIN(c.notStarted)} not started`,
  `${enIN(c.pairing)} pairing`,
  `${enIN(c.inProgress)} in progress`,
  `${enIN(c.submitted)} submitted`,
  `${enIN(c.autoSubmitted)} submitted automatically`,
  `${enIN(c.terminated)} terminated`,
];

export const LIVE_STATUS = {
  notStarted: 'Not started',
  pairing: 'Pairing',
  inProgress: 'In progress',
  submitted: 'Submitted',
  autoSubmitted: 'Submitted automatically',
  terminated: 'Terminated',
} as const;

export const LIVE_TEXTS = {
  listEmpty: {
    sentence: 'No tests are live right now. A test shows here while its window is open.',
    action: 'Go to series',
  },
  noMatch: { sentence: 'No students match these filters.', action: 'Clear filters' },
  notFoundText: (orgName: string) => `This test doesn't exist in ${orgName}.`,
  noEvents: 'No events yet.',
  extraGranted: 'Extra time granted',
  terminated: 'Attempt terminated',
  reinstated: 'Attempt reinstated',
  reset: 'Attempt reset',
  accommodationSaved: 'Accommodation saved',
  accommodationRemoved: 'Accommodation removed',
  noAccommodations: 'No accommodations.',
  currentDeadline: (ms: number) => `Current deadline: ${istTime(ms)} IST`,
  newDeadline: (ms: number) => `New deadline: ${istTime(ms)} IST`,
  overDurationTitle: "Grant more than the test's duration?",
  overDuration: (minutes: number, duration: number) =>
    `${minutes} minutes is more than the test's duration of ${duration} minutes.`,
  terminateText: 'Their answers so far will be graded, and the test ends for them now.',
  reinstateText: (deadline: number) =>
    `They can continue with the answers saved so far, until ${istTime(deadline)} IST.`,
  resetText: 'The current attempt is kept for the record, and they can start again with new questions.',
  endedByAdmin: (reason: string) => `Your placement cell ended this test. Reason: ${reason}`,
  resetHeading: 'Your attempt was reset',
  resetBody: 'Your placement cell reset this attempt. You can start the test again from your tests.',
} as const;

export const LIVE_ERRORS = {
  minutes: 'Enter whole minutes from 1 to 1,440.',
  extraReason: 'Enter a reason for the extra time.',
  terminateReason: 'Enter a reason for terminating this attempt.',
  reinstateReason: 'Enter a reason for reinstating this attempt.',
  resetReason: 'Enter a reason for resetting this attempt.',
  series: 'Choose a series.',
  pct: 'Enter a whole percentage from 1 to 200.',
  accMinutes: 'Enter whole minutes from 1 to 600.',
} as const;

/** The student's notice after a grant: `Your time was extended by 10 minutes.` */
export const extensionNotice = (minutes: number) =>
  `Your time was extended by ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`;

/** An accommodation as listed in the student drawer. */
export const accommodationText = (seriesTitle: string, a: { extraPct?: number; extraMin?: number }) =>
  a.extraPct !== undefined
    ? `${seriesTitle}: ${a.extraPct}% extra time`
    : `${seriesTitle}: ${a.extraMin} ${a.extraMin === 1 ? 'extra minute' : 'extra minutes'}`;

/** Timeline labels by event type (docs/testids/phase-5.md, "Timeline drawer"). */
export const EVENT_LABELS: Record<string, string> = {
  fullscreen_exit: 'Left fullscreen',
  tab_hidden: 'Switched to another tab or window',
  window_blur: 'Exam window lost focus',
  no_face: 'No face in view for more than 5 seconds',
  multiple_faces: 'More than one face in view',
  devtools: 'Developer tools shortcut',
  phone_disconnected: 'Phone disconnected for more than a minute',
  context_menu: 'Context menu',
  clipboard: 'Copy or paste',
  print: 'Print',
  late_sync: 'Answer synced late',
};

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A timeline item: `<HH:mm:ss> IST`, the label, and `Strike <n>` for a counted strike, nothing else. */
export function timelineItemPattern(serverTs: number, type: string, strikeNumber?: number): RegExp {
  const label = EVENT_LABELS[type];
  expect(label, `timeline label for ${type}`).toBeTruthy();
  const strike = strikeNumber ? `\\s*Strike ${strikeNumber}` : '';
  return new RegExp(`^\\s*${esc(istTimeSeconds(serverTs))} IST\\s*${esc(label!)}${strike}\\s*$`);
}

/** The `Time left` text for a deadline as seen now on the server clock (the page ticks while the test reads it). */
export async function timeLeftPattern(testApi: TestApi, deadlineAt: number): Promise<RegExp> {
  return remainingPattern(timerText, deadlineAt - (await testApi.clock.now()));
}

// ---------- the live mirror and signals in Realtime Database ----------

export type LiveRecord = {
  name?: string;
  prn?: string;
  status?: string;
  answered?: number;
  total?: number;
  strikes?: number;
  deadlineAt?: number;
  updatedAt?: number;
};

export function liveRecord(rtdb: Rtdb, orgId: string, testId: string, attemptId: string) {
  return rtdb.get<LiveRecord>(`live/${orgId}/${testId}/${attemptId}`);
}

/** Waits until the API's live record of an attempt matches. */
export async function expectLiveRecord(
  rtdb: Rtdb,
  orgId: string,
  testId: string,
  attemptId: string,
  expected: LiveRecord,
): Promise<void> {
  await expect
    .poll(() => liveRecord(rtdb, orgId, testId, attemptId), { message: `live record of ${attemptId}` })
    .toMatchObject(expected);
}

export function signalRecord(rtdb: Rtdb, orgId: string, attemptId: string) {
  return rtdb.get<{ deadlineAt?: number; notice?: string }>(`signals/${orgId}/${attemptId}`);
}

// ---------- admin actions through the API ----------

export interface ExtraTimeBody {
  minutes: unknown;
  reason?: unknown;
  confirmOverDuration?: boolean;
}

export function postExtraTime(
  admin: ApiClient,
  attemptId: string,
  body: ExtraTimeBody,
): Promise<ApiResponse<{ deadlineAt: number; extraTimeSec: number }>> {
  return admin.post<{ deadlineAt: number; extraTimeSec: number }>(`/v1/attempts/${attemptId}/extra-time`, body);
}

/** Grants extra time and fails unless the API accepts it. Returns the new deadline. */
export async function grantExtraTime(admin: ApiClient, attemptId: string, minutes: number, reason: string) {
  const res = await postExtraTime(admin, attemptId, { minutes, reason });
  expect(res.status, `extra time: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}

export type AttemptAction = 'terminate' | 'reinstate' | 'reset';

export function postAttemptAction(
  admin: ApiClient,
  attemptId: string,
  action: AttemptAction,
  body: Record<string, unknown> = { reason: `Test ${action}` },
): Promise<ApiResponse<{ status: string }>> {
  return admin.post<{ status: string }>(`/v1/attempts/${attemptId}/${action}`, body);
}

/** Runs an attempt action and fails unless the API accepts it. */
export async function attemptAction(admin: ApiClient, attemptId: string, action: AttemptAction, reason: string) {
  const res = await postAttemptAction(admin, attemptId, action, { reason });
  expect(res.status, `${action}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}

export interface ListedAttempt {
  id: string;
  studentId: string;
  status: string;
  startedAt: number;
  deadlineAt: number;
  extraTimeSec: number;
  strikesCount: number;
}

export function getTestAttempts(admin: ApiClient, testId: string): Promise<ApiResponse<{ items: ListedAttempt[] }>> {
  return admin.get<{ items: ListedAttempt[] }>(`/v1/tests/${testId}/attempts`);
}

/** `POST /v1/tests/{testId}/pairing-token` (phase 3): reserves the attempt ID, which the live view shows as Pairing. */
export async function reservePairing(student: ApiClient, testId: string): Promise<{ attemptId: string; url: string }> {
  const res = await student.post<{ attemptId: string; url: string }>(`/v1/tests/${testId}/pairing-token`, {});
  expect(res.status, `pairing token: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body;
}

/** Submits with `{ reason: "time_up" }`, which stores `auto_submitted` (docs/DECISIONS.md, submit and grading). */
export async function submitAutomatically(student: ApiClient, attemptId: string): Promise<void> {
  const res = await student.post(`/v1/attempts/${attemptId}/submit`, { reason: 'time_up' }, idempotency());
  expect(res.status, `time_up submit: ${JSON.stringify(res.body)}`).toBe(200);
}

// ---------- standing accommodations ----------

export type AccommodationBody = { extraPct: number } | { extraMin: number } | Record<string, unknown>;

export function putAccommodation(admin: ApiClient, studentId: string, seriesId: string, body: AccommodationBody) {
  return admin.put(`/v1/students/${studentId}/accommodations/${seriesId}`, body);
}

export function deleteAccommodation(admin: ApiClient, studentId: string, seriesId: string) {
  return admin.delete(`/v1/students/${studentId}/accommodations/${seriesId}`);
}

export async function setAccommodation(admin: ApiClient, studentId: string, seriesId: string, body: AccommodationBody) {
  const res = await putAccommodation(admin, studentId, seriesId, body);
  expect(res.status, `accommodation: ${JSON.stringify(res.body)}`).toBe(200);
}

/** The stored accommodations map of a student record. */
export async function storedAccommodations(
  e: Emulators,
  orgId: string,
  studentId: string,
): Promise<Record<string, { extraPct?: number; extraMin?: number }>> {
  const doc = await e.doc(`organizations/${orgId}/students/${studentId}`);
  expect(doc, `student ${studentId}`).not.toBeNull();
  return (doc!.data.accommodations as Record<string, { extraPct?: number; extraMin?: number }> | undefined) ?? {};
}

// ---------- stored state ----------

/** The attempt index entry of a student for a test, or null. */
export async function attemptIndex(
  e: Emulators,
  orgId: string,
  testId: string,
  studentId: string,
): Promise<Record<string, unknown> | null> {
  return (await e.doc(`organizations/${orgId}/attemptIndex/${testId}_${studentId}`))?.data ?? null;
}

/** Audit entries of an org for an action on an attempt (target type `attempt`). */
export async function attemptAudit(e: Emulators, orgId: string, action: string, attemptId: string) {
  const entries = await e.audit(orgId, action);
  return entries.filter((d: StoredDoc) => (d.data.target as { id?: string } | undefined)?.id === attemptId);
}

/** Waits until the stored attempt has this status. */
export async function expectAttemptStatus(e: Emulators, orgId: string, attemptId: string, status: string) {
  await expect
    .poll(async () => (await storedAttempt(e, orgId, attemptId)).status, { message: `attempt ${attemptId} status` })
    .toBe(status);
}

// ---------- pre-warming ----------

export const prewarmTaskName = (orgId: string, testId: string, windowStart: number) =>
  `prewarm-${orgId}-${testId}-${windowStart}`;

export async function runPrewarmTask(
  request: APIRequestContext,
  payload: { orgId: string; testId: string; windowStart: number },
): Promise<number> {
  const res = await request.post(`${WORKER_URL}/tasks/prewarm`, { data: payload });
  return res.status();
}

// ---------- themes for the screenshot tests (UI-15) ----------

export type ThemeName = 'light' | 'dark' | 'high-contrast';
export const THEMES: readonly ThemeName[] = ['light', 'dark', 'high-contrast'];

/** Saves the account's preferences for a theme (A11Y-02), with motion reduced so screenshots are still. */
export async function setTheme(api: ApiClient, theme: ThemeName): Promise<void> {
  const res = await api.put('/v1/me/preferences', {
    textSize: 100,
    theme: theme === 'dark' ? 'dark' : 'light',
    highContrast: theme === 'high-contrast',
    reduceMotion: 'on',
    increasedSpacing: false,
    readingRuler: false,
  });
  expect(res.status, `preferences: ${JSON.stringify(res.body)}`).toBe(200);
}

/** The `<html>` background (and for high contrast the `<body>` text colour) each theme computes. */
export const THEME_COLOURS: Record<ThemeName, { background: string; text?: string }> = {
  light: { background: 'rgb(243, 245, 247)' },
  dark: { background: 'rgb(15, 19, 38)' },
  'high-contrast': { background: 'rgb(255, 255, 255)', text: 'rgb(0, 0, 0)' },
};

// ---------- the exam-day runbook (REL-07, A11Y-18) ----------

export const RUNBOOK_PATH = new URL('../../../docs/runbooks/exam-day.md', import.meta.url).pathname;

/** The runbook's text, or null when the file does not exist. */
export async function readRunbook(): Promise<string | null> {
  try {
    return await readFile(RUNBOOK_PATH, 'utf8');
  } catch {
    return null;
  }
}

/** The body of a level-2 section (`## Heading`) up to the next level-2 heading, or null. */
export function runbookSection(text: string, heading: string): string | null {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n');
}
