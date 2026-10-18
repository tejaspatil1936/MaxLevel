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
