import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { errorCode, type ApiClient, type ApiResponse } from './api';
import type { Emulators, StoredDoc } from './emulators';
import type { TestApi } from './test-api';

// Phase 3 exam facts, time formatting and stored-state reads (docs/testids/phase-3.md). Seeds come from the test-only
// API (`exam-test`); these helpers start attempts through the real API and read what the system stored.

// ---------- time as students see it (org timezone Asia/Kolkata, UTC+05:30, no daylight saving) ----------

const IST_OFFSET_MS = 330 * 60_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number) => String(n).padStart(2, '0');

/** `HH:mm` of an instant in IST. */
export function istTime(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${two(d.getUTCHours())}:${two(d.getUTCMinutes())}`;
}

/** `d MMM yyyy` of an instant in IST (`2 Nov 2026`). */
export function istDate(ms: number): string {
  const d = new Date(ms + IST_OFFSET_MS);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** A window as students see it: `2 Nov 2026, 10:00 to 11:00 IST`, or with both dates when it ends on another day. */
export function windowText(start: number, end: number): string {
  return istDate(start) === istDate(end)
    ? `${istDate(start)}, ${istTime(start)} to ${istTime(end)} IST`
    : `${istDate(start)}, ${istTime(start)} to ${istDate(end)}, ${istTime(end)} IST`;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Dashboard countdown text for a remaining time: `HH:MM:SS`, `1 day HH:MM:SS`, `<n> days HH:MM:SS`. */
export function countdownText(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  const days = Math.floor(s / 86_400);
  const hms = `${two(Math.floor((s % 86_400) / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return days === 0 ? hms : `${days} ${days === 1 ? 'day' : 'days'} ${hms}`;
}

/** Exam timer text: `MM:SS` below one hour, `H:MM:SS` from one hour. */
export function timerText(remainingMs: number): string {
  const s = Math.max(0, Math.floor(remainingMs / 1000));
  const h = Math.floor(s / 3600);
  const mmss = `${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`;
  return h === 0 ? mmss : `${h}:${mmss}`;
}

/**
 * A pattern accepting what `format` shows for any remaining time between `remainingMs - slackMs` and
 * `remainingMs + 1000` (the page ticks while the test reads it).
 */
export function remainingPattern(format: (ms: number) => string, remainingMs: number, slackMs = 15_000): RegExp {
  const options = new Set<string>();
  for (let ms = remainingMs + 1000; ms >= remainingMs - slackMs; ms -= 1000) options.add(format(ms));
  return new RegExp(`^\\s*(?:${[...options].map(esc).join('|')})\\s*$`);
}

/** The marking line: `+1 for a correct answer, −0.25 for a wrong answer, 0 for no answer` (U+2212 minus). */
export function markingText(marks: number, negativeMarks: number): string {
  const n = (v: number) => new Intl.NumberFormat('en-IN').format(v);
  const wrong = negativeMarks === 0 ? '0' : `−${n(negativeMarks)}`;
  return `+${n(marks)} for a correct answer, ${wrong} for a wrong answer, 0 for no answer`;
}

// ---------- fixed texts ----------

export const PRIVACY_NOTE =
  'Camera video never leaves your device. Only proctoring events, such as leaving fullscreen, are sent to the server.';
export const AGREEMENT = 'I have read the rules and agree to follow them';

export const DASHBOARD_EMPTY = {
  sentence:
    'No tests are open to you yet. Tests are offered by department and graduation year, so check that your profile is right.',
  action: 'Review your profile',
} as const;

export const START_BLOCKED = {
  checks: 'Complete the device checks first.',
  agreement: 'Tick the agreement to start.',
  phone: 'Connect your phone first.',
} as const;

export const FIX_LINES = {
  'Screen width': 'Use a screen at least 1,024 px wide. If you zoomed in, zoom out until this check passes.',
  Fullscreen: "Your browser can't go fullscreen. Use current Chrome, Edge or Firefox.",
  Camera: 'Connect a camera and allow this site to use it, then press Check again.',
  'Face detection': "Face detection didn't load. Reload the page, or use current Chrome or Edge.",
  Connection: "Can't reach the exam server. Check your internet connection, then press Check again.",
  Clock: "Your computer's clock is off by more than 5 minutes. Set it to update automatically, then press Check again.",
  Browser: 'Use current Chrome, Edge or Firefox, or Safari 17 or later.',
} as const;
export type CheckName = keyof typeof FIX_LINES;

export const STRIKE_REASONS = {
  fullscreen_exit: 'You left fullscreen.',
  tab_hidden: 'You switched to another tab or window.',
  window_blur: 'The exam window lost focus.',
  no_face: "We couldn't see your face for more than 5 seconds.",
  multiple_faces: 'More than one face was in view.',
  devtools: 'Developer tools are not allowed.',
  phone_disconnected: 'Your phone camera was disconnected for more than a minute.',
} as const;

export const strikesLeftText = (left: number) =>
  left === 1 ? '1 strike left before the test ends.' : `${left} strikes left before the test ends.`;

export const terminatedText = (max: number) =>
  `You reached the maximum of ${max} strikes. Your answers so far have been graded.`;

export const SUBMITTED = {
  heading: 'Test submitted',
  ended: 'Your test was ended',
  auto: 'Time ran out, so your test was submitted automatically.',
  afterClose: (closeMs: number) => `Results will be released after the window closes at ${istTime(closeMs)} IST.`,
  offline: "You're offline. Your test will be submitted as soon as the connection returns.",
} as const;

export const SHORTCUTS = [
  '1 to 6 or A to F: choose an option',
  'N: next question',
  'P: previous question',
  'M: mark for review',
  'T: hear the time left',
  '?: show these shortcuts',
] as const;

export const PAIRING = {
  used: 'This pairing link has already been used. Show a new code on your laptop and scan it again.',
  expired: 'This pairing link has expired. Show a new code on your laptop and scan it again.',
  invalid: "This pairing link isn't valid. Show a new code on your laptop and scan it again.",
  expiresAt: (ms: number) => `This code works once and expires at ${istTime(ms)} IST.`,
  reconnect: 'Your phone camera is disconnected. Scan this code with your phone to reconnect it.',
} as const;

/** The web origin's pairing link for a token. */
export const PAIRING_LINK = /^http:\/\/localhost:3000\/pair\/\?token=[^&\s]+$/;

/** The `sectioned` set's correct option is always the first, `Option one`. */
export const SECTIONED_OPTIONS = ['Option one', 'Option two', 'Option three', 'Option four'] as const;

// ---------- the attempt API ----------

/** Shape of the exam payload the tests rely on (docs/testids/phase-3.md, "Exam payload"). */
export interface ExamPayload {
  attempt: {
    id: string;
    testId: string;
    status: string;
    startedAt: number;
    deadlineAt: number;
    strikesCount: number;
    maxStrikes: number;
  };
  questions: Array<{
    id: string;
    sectionId: string | null;
    prompt: string;
    options: Array<{ id: string; text: string }>;
  }>;
  sections: Array<{ id: string; name: string }>;
  answers: Record<string, { optionId: string | null; seq: number; markedForReview?: boolean }>;
  serverTime: number;
}

export const idempotency = (key: string = randomUUID()) => ({ 'idempotency-key': key });

/** `POST /v1/attempts` with a fresh (or given) Idempotency-Key. */
export function postStart(api: ApiClient, testId: string, key?: string): Promise<ApiResponse<ExamPayload>> {
  return api.post<ExamPayload>('/v1/attempts', { testId }, idempotency(key));
}

/** Starts (or returns) the caller's attempt for a test and fails unless the API accepts it. */
export async function startAttempt(api: ApiClient, testId: string, key?: string): Promise<ExamPayload> {
  const res = await postStart(api, testId, key);
  expect([200, 201], `POST /v1/attempts: ${JSON.stringify(res.body)}`).toContain(res.status);
  return res.body;
}

export interface AnswerWrite {
  questionId: string;
  optionId: string | null;
  seq: number;
  clientTs: number;
  markedForReview?: boolean;
}

export interface AnswerSyncBody {
  saved: string[];
  stale: string[];
  rejected: Array<{ questionId: string; code: string }>;
  serverTime: number;
}

export function putAnswers(
  api: ApiClient,
  attemptId: string,
  answers: AnswerWrite[],
  sync: { backlog: number; clockOffsetMs: number } = { backlog: 0, clockOffsetMs: 0 },
): Promise<ApiResponse<AnswerSyncBody>> {
  return api.put<AnswerSyncBody>(`/v1/attempts/${attemptId}/answers`, { answers, ...sync });
}

export interface EventBody {
  strikesCount: number;
  counted: boolean;
  status: string;
}

export function postEvent(
  api: ApiClient,
  attemptId: string,
  type: string,
  clientTs: number,
  details: Record<string, unknown> = {},
): Promise<ApiResponse<EventBody>> {
  return api.post<EventBody>(`/v1/attempts/${attemptId}/events`, { type, clientTs, details });
}

export interface ListedEvent {
  id: string;
  type: string;
  details: Record<string, unknown>;
  clientTs: number;
  serverTs: number;
  strikeNumber?: number;
}

export async function listEvents(api: ApiClient, attemptId: string): Promise<ListedEvent[]> {
  const res = await api.get<{ items: ListedEvent[] }>(`/v1/attempts/${attemptId}/events`);
  expect(res.status, `GET events: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body.items;
}

/** Fails unless the response is an API-01 error with this status and code. */
export function expectApiError(res: ApiResponse<unknown>, status: number, code?: string): void {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  if (code) expect(errorCode(res), JSON.stringify(res.body)).toBe(code);
}

/** True when the JSON of a body names an answer key or holds any of these explanation texts (DATA-05). */
export function leaksAnswerKey(body: unknown, explanations: readonly string[] = []): string[] {
  const json = JSON.stringify(body);
  const found: string[] = [];
  for (const key of ['correctOptionIds', 'explanation']) if (json.includes(`"${key}"`)) found.push(key);
  for (const text of explanations) if (json.includes(JSON.stringify(text).slice(1, -1))) found.push(text);
  return found;
}

// ---------- stored state ----------

const orgPath = (orgId: string) => `organizations/${orgId}`;

export async function storedAttempt(e: Emulators, orgId: string, attemptId: string): Promise<Record<string, unknown>> {
  const doc = await e.doc(`${orgPath(orgId)}/attempts/${attemptId}`);
  expect(doc, `attempt ${attemptId} in ${orgId}`).not.toBeNull();
  return doc!.data;
}

/** Every attempt of a test in an org, as stored. */
export function attemptsOfTest(e: Emulators, orgId: string, testId: string): Promise<StoredDoc[]> {
  return e.where(orgPath(orgId), 'attempts', 'testId', testId);
}

/** The answer records of an attempt, keyed by question ID (doc ID). */
export async function storedAnswers(
  e: Emulators,
  orgId: string,
  attemptId: string,
): Promise<Record<string, Record<string, unknown>>> {
  const docs = await e.list(`${orgPath(orgId)}/attempts/${attemptId}`, 'answers');
  return Object.fromEntries(docs.map((d) => [d.id, d.data]));
}

/** The event records of an attempt, in server-time order. */
export async function storedEvents(e: Emulators, orgId: string, attemptId: string): Promise<StoredDoc[]> {
  const docs = await e.list(`${orgPath(orgId)}/attempts/${attemptId}`, 'events');
  return docs.sort((a, b) => Number(a.data.serverTs) - Number(b.data.serverTs));
}

/** The attempt ID in an `/exam/?attempt=` URL. */
export function attemptIdFromUrl(url: string): string {
  const id = new URL(url).searchParams.get('attempt');
  expect(id, `attempt ID in ${url}`).toBeTruthy();
  return id!;
}

// ---------- time travel ----------

/**
 * Moves the API's (and worker's) test clock and the page's device clock forward together, so the exam's server offset
 * stays right (docs/testids/phase-3.md, "Server time"). The page must have had `page.clock.install()` before loading.
 */
export async function advanceExamTime(page: Page, testApi: TestApi, ms: number): Promise<void> {
  await testApi.clock.advance(ms);
  await page.clock.fastForward(ms);
}

/** Waits until a stored attempt matches, polling the emulator (the API writes asynchronously to the browser). */
export async function expectAttemptSoon(
  e: Emulators,
  orgId: string,
  attemptId: string,
  check: (a: Record<string, unknown>) => boolean,
  message: string,
): Promise<Record<string, unknown>> {
  let last: Record<string, unknown> = {};
  await expect
    .poll(
      async () => {
        last = await storedAttempt(e, orgId, attemptId);
        return check(last);
      },
      { message, timeout: 20_000 },
    )
    .toBe(true);
  return last;
}

/**
 * Waits until the stored events of an attempt satisfy `check` (the event report may still be in flight when a warning
 * shows), then returns them.
 */
export async function expectEventsSoon(
  e: Emulators,
  orgId: string,
  attemptId: string,
  check: (events: StoredDoc[]) => boolean,
  message: string,
): Promise<StoredDoc[]> {
  let last: StoredDoc[] = [];
  await expect
    .poll(
      async () => {
        last = await storedEvents(e, orgId, attemptId);
        return check(last);
      },
      { message, timeout: 20_000 },
    )
    .toBe(true);
  return last;
}

/** Strike numbers of the stored events of one type, in order (undefined for events that did not count). */
export const strikeNumbersOf = (events: StoredDoc[], type: string) =>
  events.filter((ev) => ev.data.type === type).map((ev) => ev.data.strikeNumber);
