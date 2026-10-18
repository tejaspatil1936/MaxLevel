import { describe, expect, it } from 'vitest';
import type { AttemptStatus } from './attempt';
import {
  LEADERBOARD_PAGE_ROWS,
  boardResponseSchema,
  leaderboardPages,
  leaderboardRecordSchema,
  parseBoardId,
  rankSeries,
  rankTest,
  seriesBoardId,
  studentBoardView,
  testBoardId,
  type RankableAttempt,
} from './leaderboard';

const T0 = 1_793_595_600_000;
const att = (studentId: string, score: number, more: Partial<RankableAttempt> = {}): RankableAttempt => ({
  studentId,
  name: `Student ${studentId}`,
  departmentId: 'dep-1',
  status: 'submitted',
  score,
  timeSec: 600,
  submittedAt: T0,
  ...more,
});
const ranks = (rows: Array<{ studentId: string; rank: number }>) => rows.map((r) => [r.studentId, r.rank]);

describe('rankTest', () => {
  it('LB-01 ranks higher scores first; equal score, time and submission second share a rank and the next skips', () => {
    const rows = rankTest([att('d', 5), att('b', 8), att('a', 10), att('c', 8, { submittedAt: T0 + 999 })]);
    expect(ranks(rows)).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 2],
      ['d', 4],
    ]);
    expect(rows[0]).toEqual({
      studentId: 'a',
      name: 'Student a',
      departmentId: 'dep-1',
      score: 10,
      rank: 1,
      timeSec: 600,
    });
  });

  it('LB-01 breaks an equal score by the shorter time, then by the earlier submission', () => {
    const rows = rankTest([
      att('late', 8, { submittedAt: T0 + 1000 }),
      att('slow', 8, { timeSec: 601, submittedAt: T0 - 60_000 }),
      att('fast', 8, { timeSec: 300, submittedAt: T0 + 5000 }),
      att('early', 8),
    ]);
    expect(ranks(rows)).toEqual([
      ['fast', 1],
      ['early', 2],
      ['late', 3],
      ['slow', 4],
    ]);
  });

  it('LB-01 PR-10 leaves out terminated, reset and in-progress attempts; no attempts give no rows', () => {
    const left: AttemptStatus[] = ['terminated', 'reset', 'in_progress'];
    const rows = rankTest([att('t', 20, { status: 'auto_submitted' }), ...left.map((s) => att(s, 30, { status: s }))]);
    expect(ranks(rows)).toEqual([['t', 1]]);
    expect(rankTest([])).toEqual([]);
  });

  it('LB-01 lists rows that share a rank by name', () => {
    const rows = rankTest([
      att('1', 7, { name: 'Zoya' }),
      att('2', 7, { name: 'aarav' }),
      att('3', 7, { name: 'Meera' }),
    ]);
    expect(rows.map((r) => [r.name, r.rank])).toEqual([
      ['aarav', 1],
      ['Meera', 1],
      ['Zoya', 1],
    ]);
  });
});

describe('rankSeries', () => {
  it('LB-02 sums each student over the tests, a test not taken counting 0 with a null entry, times summed', () => {
    const rows = rankSeries([
      { testId: 't1', attempts: [att('a', 6, { timeSec: 100 }), att('b', 9, { timeSec: 200 })] },
      { testId: 't2', attempts: [att('a', 4.25, { timeSec: 50 })] },
    ]);
    expect(rows).toEqual([
      {
        studentId: 'a',
        name: 'Student a',
        departmentId: 'dep-1',
        score: 10.25,
        rank: 1,
        timeSec: 150,
        scores: { t1: 6, t2: 4.25 },
      },
      {
        studentId: 'b',
        name: 'Student b',
        departmentId: 'dep-1',
        score: 9,
        rank: 2,
        timeSec: 200,
        scores: { t1: 9, t2: null },
      },
    ]);
  });

  it('LB-02 PR-10 counts nothing for a terminated attempt, and a student with only terminated attempts gets no row', () => {
    const rows = rankSeries([
      { testId: 't1', attempts: [att('a', 5), att('x', 9, { status: 'terminated' })] },
      { testId: 't2', attempts: [att('a', 5, { status: 'terminated' }), att('x', 9, { status: 'terminated' })] },
    ]);
    expect(rows.map((r) => [r.studentId, r.score, r.scores])).toEqual([['a', 5, { t1: 5, t2: null }]]);
  });

  it('LB-02 gives equal totals a shared rank (1, 2, 2, 4), whatever the times, ties listed by name', () => {
    const rows = rankSeries([
      { testId: 't1', attempts: [att('a', 10), att('c', 4, { timeSec: 900 }), att('b', 8), att('d', 1)] },
      { testId: 't2', attempts: [att('c', 4, { timeSec: 10 }), att('d', 2)] },
    ]);
    expect(ranks(rows)).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 2],
      ['d', 4],
    ]);
    expect(rankSeries([])).toEqual([]);
  });
});

describe('board size and paging', () => {
  const rowsOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      studentId: `stu-org-a-${String(i).padStart(5, '0')}`,
      name: `${'N'.repeat(54)}${String(i).padStart(6, '0')}`,
      departmentId: 'dep-computer-engineering',
      score: 123.75,
      rank: i + 1,
      timeSec: 3599,
    }));

  it('DATA-04 stores 2,000 rows with 60-character names in one record well under 1 MiB', () => {
    const rows = rowsOf(2000);
    expect(rows[0]!.name).toHaveLength(60);
    const record = leaderboardRecordSchema.parse({ computedAt: T0, rows });
    expect(Buffer.byteLength(JSON.stringify(record), 'utf8')).toBeLessThan(1_048_576);
    expect(Buffer.byteLength(JSON.stringify({ computedAt: T0, rows: rowsOf(LEADERBOARD_PAGE_ROWS) }))).toBeLessThan(
      1_048_576,
    );
  });

  it('DATA-04 keeps up to a page of rows in one page and splits 12,001 rows into ordered pages of at most 5,000', () => {
    expect(leaderboardPages([])).toEqual([[]]);
    const one = rowsOf(LEADERBOARD_PAGE_ROWS);
    expect(leaderboardPages(one)).toEqual([one]);
    const many = rowsOf(12_001);
    const pages = leaderboardPages(many);
    expect(pages.map((p) => p.length)).toEqual([5000, 5000, 2001]);
    expect(pages.flat()).toEqual(many);
  });

  it('DATA-04 LB-05 shows a student the first 50 rows and their own row wherever it is, or null', () => {
    const rows = rowsOf(120);
    const inside = studentBoardView(rows, rows[7]!.studentId);
    expect(inside.rows).toEqual(rows.slice(0, 50));
    expect(inside.me).toBe(rows[7]);
    expect(studentBoardView(rows, rows[99]!.studentId).me).toBe(rows[99]);
    expect(studentBoardView(rows, 'stu-missing').me).toBeNull();
    expect(studentBoardView(rows, rows[0]!.studentId, 10).rows).toHaveLength(10);
  });
});

describe('board ids and response', () => {
  it('LB-05 names boards test_<id> and series_<id> and parses them back', () => {
    expect(testBoardId('t1')).toBe('test_t1');
    expect(seriesBoardId('s_1')).toBe('series_s_1');
    expect(parseBoardId('series_s_1')).toEqual({ kind: 'series', refId: 's_1' });
    expect(parseBoardId('test_')).toBeNull();
    expect(parseBoardId('board_t1')).toBeNull();
  });

  it('LB-05 DATA-05 the board response carries no student IDs or answer keys', () => {
    const row = {
      rank: 1,
      name: 'A',
      department: 'Computer',
      score: 2,
      timeSec: 5,
      studentId: 's',
      correctOptionIds: ['x'],
    };
    const body = boardResponseSchema.parse({
      boardId: 'test_t1',
      kind: 'test',
      title: 'T',
      computedAt: null,
      total: 1,
      rows: [row],
      me: row,
    });
    expect(JSON.stringify(body)).not.toMatch(/studentId|correctOptionIds/);
  });
});
