import { z } from 'zod';
import type { AttemptStatus } from './attempt';

// Leaderboard ranking (spec 8.2 LB-01, LB-02, LB-05; 10.1 DATA-04; docs/testids/phase-4.md "Leaderboards").
// Boards are stored one record per board, `organizations/{orgId}/leaderboards/test_<testId>` and `…/series_<seriesId>`,
// rows in rank order. Ranking lives only here (spec 9.5).

const id = z.string().min(1).max(128);

export const BOARD_KINDS = ['test', 'series'] as const;
export const boardKindSchema = z.enum(BOARD_KINDS);
export type BoardKind = z.infer<typeof boardKindSchema>;

export const testBoardId = (testId: string) => `test_${testId}`;
export const seriesBoardId = (seriesId: string) => `series_${seriesId}`;

/** Splits `test_<id>` or `series_<id>`; anything else is null. */
export function parseBoardId(boardId: string): { kind: BoardKind; refId: string } | null {
  const m = /^(test|series)_(.+)$/.exec(boardId);
  if (!m || !id.safeParse(m[2]).success) return null;
  return { kind: m[1] as BoardKind, refId: m[2]! };
}

/** One stored row (spec 10.1). Series rows also keep each test's counted score (null = not counted). */
export const leaderboardRowSchema = z.object({
  studentId: id,
  name: z.string(),
  departmentId: z.string(),
  score: z.number(),
  rank: z.number().int().min(1),
  timeSec: z.number().int().min(0),
  scores: z.record(z.string(), z.number().nullable()).optional(),
});

/** The stored record `leaderboards/{boardId}`. */
export const leaderboardRecordSchema = z.object({
  computedAt: z.number().int(),
  rows: z.array(leaderboardRowSchema),
});
export type LeaderboardRecord = z.infer<typeof leaderboardRecordSchema>;

/** A row of `GET /v1/leaderboards/{boardId}`: the department's name, no student ID (DECISIONS Q28). */
export const boardRowSchema = z.object({
  rank: z.number().int().min(1),
  name: z.string(),
  department: z.string(),
  score: z.number(),
  timeSec: z.number().int().min(0),
});
export type BoardRow = z.infer<typeof boardRowSchema>;

/** `GET /v1/leaderboards/{boardId}` (LB-05): students get the top 50 and `me`, admins every row and `me: null`. */
export const boardResponseSchema = z.object({
  boardId: z.string(),
  kind: boardKindSchema,
  title: z.string(),
  computedAt: z.number().int().nullable(),
  total: z.number().int().min(0),
  max: z.number().optional(),
  rows: z.array(boardRowSchema),
  me: boardRowSchema.nullable(),
});
export type BoardResponse = z.infer<typeof boardResponseSchema>;

/** A board open to the student, as listed on `/student/leaderboards/` (US-ST-09, LB-04). */
export const openBoardSchema = z.object({ boardId: z.string(), kind: boardKindSchema, title: z.string() });
export type OpenBoard = z.infer<typeof openBoardSchema>;
/** `GET /v1/student/leaderboards`: the boards open to the caller, series boards before their tests' boards. */
export const studentLeaderboardsSchema = z.object({ boards: z.array(openBoardSchema) });
export type StudentLeaderboards = z.infer<typeof studentLeaderboardsSchema>;

/** A test board's title is the test heading: `Day 1: Quantitative aptitude`, or the title when the day is hidden. */
export const testBoardTitle = (title: string, dayLabel: string | null) => (dayLabel ? `${dayLabel}: ${title}` : title);

export interface BoardResponseInput {
  boardId: string;
  kind: BoardKind;
  title: string;
  max?: number;
  /** The stored board, or null while it has not been computed. */
  board: { computedAt: number; total: number; rows: ReadonlyArray<LeaderboardRow> } | null;
  /** Department names by ID (DECISIONS Q28); an unknown ID shows as empty. */
  departments: ReadonlyMap<string, string>;
  /** The student asking, or null for an admin. */
  studentId: string | null;
}

/**
 * LB-05, US-ST-09: the served board. A student gets the first 50 rows and their own row as `me`; an admin every row
 * and `me: null`. Rows carry the department's name and no student ID.
 */
export function boardResponse(input: BoardResponseInput): BoardResponse {
  const stored = input.board?.rows ?? [];
  const view = input.studentId === null ? { rows: [...stored], me: null } : studentBoardView(stored, input.studentId);
  const served = (r: LeaderboardRow): BoardRow => ({
    rank: r.rank,
    name: r.name,
    department: input.departments.get(r.departmentId) ?? '',
    score: r.score,
    timeSec: r.timeSec,
  });
  return {
    boardId: input.boardId,
    kind: input.kind,
    title: input.title,
    computedAt: input.board?.computedAt ?? null,
    total: input.board?.total ?? 0,
    ...(input.max !== undefined ? { max: input.max } : {}),
    rows: view.rows.map(served),
    me: view.me ? served(view.me) : null,
  };
}

export interface RankableAttempt {
  studentId: string;
  name: string;
  departmentId: string;
  status: AttemptStatus;
  score: number;
  timeSec: number;
  submittedAt: number;
}

export interface LeaderboardRow {
  studentId: string;
  name: string;
  departmentId: string;
  score: number;
  rank: number;
  timeSec: number;
}

export interface SeriesLeaderboardRow extends LeaderboardRow {
  /** Per testId: the counted score, or null when the test was not taken or not counted. */
  scores: Record<string, number | null>;
}

/** Statuses that rank: terminated, reset and in-progress attempts never do (PR-10, DECISIONS Q23). */
const RANKED_STATUSES: ReadonlySet<AttemptStatus> = new Set(['submitted', 'auto_submitted']);

const byName = new Intl.Collator('en').compare;
const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** Sorts by `key` (equal keys share a rank, the next rank skips), ties listed by name, then student ID. */
function competitionRank<T extends Omit<LeaderboardRow, 'rank'>>(
  items: T[],
  key: (a: T, b: T) => number,
): Array<T & { rank: number }> {
  const sorted = [...items].sort(
    (a, b) =>
      key(a, b) || byName(a.name, b.name) || (a.studentId < b.studentId ? -1 : a.studentId > b.studentId ? 1 : 0),
  );
  const out: Array<T & { rank: number }> = [];
  sorted.forEach((item, i) => {
    const prev = out[i - 1];
    const rank = prev && key(sorted[i - 1]!, item) === 0 ? prev.rank : i + 1;
    out.push({ ...item, rank });
  });
  return out;
}

/**
 * LB-01: higher score, then shorter time taken, then earlier submission (whole seconds). Rows equal on all three share
 * a rank (1, 2, 2, 4).
 */
export function rankTest(attempts: ReadonlyArray<RankableAttempt>): LeaderboardRow[] {
  const rows = attempts
    .filter((a) => RANKED_STATUSES.has(a.status))
    .map((a) => ({
      studentId: a.studentId,
      name: a.name,
      departmentId: a.departmentId,
      score: a.score,
      timeSec: a.timeSec,
      second: Math.floor(a.submittedAt / 1000),
    }));
  return competitionRank(rows, (a, b) => b.score - a.score || a.timeSec - b.timeSec || a.second - b.second).map(
    (r) => ({
      studentId: r.studentId,
      name: r.name,
      departmentId: r.departmentId,
      score: r.score,
      rank: r.rank,
      timeSec: r.timeSec,
    }),
  );
}

/**
 * LB-02: one row per student with a counted attempt (a `rankTest` row). The score is the sum over the tests, a test not
 * taken counting 0; `timeSec` the sum of counted times; equal totals share a rank. The caller passes only the tests whose
 * results are public. Name and department come from the student's latest counted test.
 */
export function rankSeries(
  tests: ReadonlyArray<{ testId: string; attempts: ReadonlyArray<RankableAttempt> }>,
): SeriesLeaderboardRow[] {
  const byStudent = new Map<string, Omit<SeriesLeaderboardRow, 'rank'>>();
  const empty = () => Object.fromEntries(tests.map((t) => [t.testId, null])) as Record<string, number | null>;
  for (const test of tests) {
    for (const row of rankTest(test.attempts)) {
      const acc = byStudent.get(row.studentId) ?? { ...row, score: 0, timeSec: 0, scores: empty() };
      acc.name = row.name;
      acc.departmentId = row.departmentId;
      acc.score = tidy(acc.score + row.score);
      acc.timeSec += row.timeSec;
      acc.scores[test.testId] = tidy((acc.scores[test.testId] ?? 0) + row.score);
      byStudent.set(row.studentId, acc);
    }
  }
  return competitionRank([...byStudent.values()], (a, b) => b.score - a.score).map((r) => ({
    studentId: r.studentId,
    name: r.name,
    departmentId: r.departmentId,
    score: r.score,
    rank: r.rank,
    timeSec: r.timeSec,
    scores: r.scores,
  }));
}

/** LB-05: how many ranked rows a student sees. */
export const LEADERBOARD_STUDENT_ROWS = 50;

/** LB-05: the first `top` rows, and the student's own row wherever it is (null when absent). */
export function studentBoardView<T extends { studentId: string }>(
  rows: ReadonlyArray<T>,
  studentId: string,
  top: number = LEADERBOARD_STUDENT_ROWS,
): { rows: T[]; me: T | null } {
  return { rows: rows.slice(0, top), me: rows.find((r) => r.studentId === studentId) ?? null };
}

/** DATA-04: the most rows on one stored page. */
export const LEADERBOARD_PAGE_ROWS = 5000;

/**
 * DATA-04: the most estimated bytes of rows on one stored page. Firestore refuses a record above 1 MiB (1,048,576
 * bytes); this leaves room for the record's path and its `computedAt`, `total` and `pageCount` fields.
 */
export const LEADERBOARD_PAGE_BYTES = 900_000;

/** UTF-8 length without encoding; an unpaired surrogate counts 4, never less than it takes. */
function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Firestore's stored size of a value (firebase.google.com/docs/firestore/storage-size): a string is its UTF-8 length
 * plus 1, a number 8, null or a boolean 1, an array the sum of its values, a map the sum of each key (as a string) and
 * value. Undefined fields are not stored.
 */
export function firestoreValueBytes(v: unknown): number {
  if (v === undefined) return 0;
  if (v === null || typeof v === 'boolean') return 1;
  if (typeof v === 'number') return 8;
  if (typeof v === 'string') return utf8Bytes(v) + 1;
  if (Array.isArray(v)) return v.reduce((sum: number, x) => sum + firestoreValueBytes(x), 0);
  let sum = 0;
  for (const [k, x] of Object.entries(v as object))
    if (x !== undefined) sum += utf8Bytes(k) + 1 + firestoreValueBytes(x);
  return sum;
}

/**
 * DATA-04: the rows in order, in pages of at most `LEADERBOARD_PAGE_ROWS` rows and `LEADERBOARD_PAGE_BYTES` estimated
 * bytes, so wide series rows (a score per test) and non-Latin names still fit a record; always at least one (possibly
 * empty) page.
 */
export function leaderboardPages<T>(rows: ReadonlyArray<T>, maxBytes: number = LEADERBOARD_PAGE_BYTES): T[][] {
  const pages: T[][] = [[]];
  let bytes = 0;
  for (const row of rows) {
    const size = firestoreValueBytes(row);
    const page = pages[pages.length - 1]!;
    if (page.length > 0 && (page.length >= LEADERBOARD_PAGE_ROWS || bytes + size > maxBytes)) {
      pages.push([row]);
      bytes = size;
    } else {
      page.push(row);
      bytes += size;
    }
  }
  return pages;
}
