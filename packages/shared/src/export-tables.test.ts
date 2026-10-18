import { describe, expect, it } from 'vitest';
import { exportCsv, seriesExportTable, testExportTable, type ExportAttempt, type ExportStudent } from './export-tables';
import { rankSeries, rankTest } from './leaderboard';

const T0 = 1793592000000; // 2 Nov 2026, 09:30 IST
const who = (name: string, n: number): ExportStudent => ({
  name,
  email: `s${n}@a.test`,
  prn: `2201010${n}`,
  department: 'Computer Engineering',
  graduationYear: 2026,
});
const students = new Map([
  ['s1', who('Asha', 1)],
  ['s2', who('Bina', 2)],
  ['s3', who('Chirag', 3)],
  ['s4', { ...who('Dev', 4), email: '=cmd|calc' }],
]);
const result = (score: number, durationSec = 600) => ({
  score,
  max: 3,
  pct: (score / 3) * 100,
  correct: score,
  incorrect: 0,
  unanswered: 3 - score,
  durationSec,
  sections: { q: { score }, v: { score: 0 } },
});
const attempt = (studentId: string, status: ExportAttempt['status'], score?: number): ExportAttempt => ({
  studentId,
  status,
  startedAt: T0,
  ...(status === 'in_progress' ? {} : { submittedAt: T0 + 600_000 }),
  strikesCount: status === 'terminated' ? 3 : 0,
  ...(status === 'terminated' ? { terminationReason: 'max_strikes' } : {}),
  extraTimeSec: studentId === 's2' ? 90 : 0,
  ...(score === undefined ? {} : { result: result(score) }),
});

describe('test export table', () => {
  const attempts = [
    attempt('s1', 'submitted', 1),
    attempt('s2', 'auto_submitted', 2),
    attempt('s3', 'terminated', 3),
    attempt('s4', 'in_progress'),
    attempt('s1', 'reset', 0),
  ];
  const rankable = attempts.map((a) => ({
    studentId: a.studentId,
    name: students.get(a.studentId)!.name,
    departmentId: 'd',
    status: a.status,
    score: a.result?.score ?? 0,
    timeSec: 600,
    submittedAt: a.submittedAt ?? 0,
  }));
  const ranks = new Map(rankTest(rankable).map((r) => [r.studentId, r.rank]));
  const table = testExportTable({
    sections: [
      { id: 'q', name: 'Quant' },
      { id: 'v', name: 'Verbal' },
    ],
    attempts,
    students,
    ranks,
    timeZone: 'Asia/Kolkata',
    zone: 'IST',
  });

  it('EXP-01 one row per attempt that is not reset, ranked rows by rank, then the rest by name', () => {
    expect(table.rows.map((r) => [r[0], r[5], r[9]])).toEqual([
      ['Bina', 'Submitted automatically', 1],
      ['Asha', 'Submitted', 2],
      ['Chirag', 'Ended after strikes', null],
      ['Dev', 'In progress', null],
    ]);
  });

  it('EXP-01 each row holds the profile, the score, sections, counts, IST times, strikes and extra time', () => {
    expect(table.columns).toHaveLength(21);
    expect(table.rows[0]).toEqual([
      'Bina',
      's2@a.test',
      '22010102',
      'Computer Engineering',
      2026,
      'Submitted automatically',
      2,
      3,
      66.67,
      1,
      2,
      0,
      2,
      0,
      1,
      '2026-11-02 09:30:00',
      '2026-11-02 09:40:00',
      600,
      0,
      null,
      1.5,
    ]);
    expect(table.rows[2]!.slice(-3)).toEqual([3, 'Maximum strikes reached', 0]);
    expect(table.rows[3]!.slice(6, 9)).toEqual([null, null, null]);
    expect(table.rows[3]![16]).toBeNull();
  });

  it('EXP-01 SEC-06 the CSV has a byte order mark, RFC 4180 lines and formula-safe text', () => {
    const csv = exportCsv(table);
    expect(csv.startsWith('﻿Name,Email,PRN,')).toBe(true);
    const lines = csv.slice(1).split('\r\n');
    expect(lines).toHaveLength(6);
    expect(lines[5]).toBe('');
    expect(lines[1]).toBe(
      'Bina,s2@a.test,22010102,Computer Engineering,2026,Submitted automatically,2,3,66.67,1,2,0,2,0,1,' +
        '2026-11-02 09:30:00,2026-11-02 09:40:00,600,0,,1.5',
    );
    expect(lines[4]!.startsWith("Dev,'=cmd|calc,")).toBe(true);
  });
});

describe('series export table', () => {
  const sat = (studentId: string, status: 'submitted' | 'terminated', score: number) => ({
    studentId,
    name: students.get(studentId)!.name,
    departmentId: 'd',
    status,
    score,
    timeSec: 600,
    submittedAt: T0,
  });
  const board = rankSeries([
    { testId: 't1', attempts: [sat('s1', 'submitted', 3), sat('s2', 'submitted', 4), sat('s3', 'terminated', 2)] },
    { testId: 't2', attempts: [sat('s1', 'submitted', 2), sat('s4', 'submitted', 1)] },
  ]);
  const table = seriesExportTable({
    tests: [
      { id: 't1', heading: 'Day 1: Quant' },
      { id: 't2', heading: 'Day 2: Verbal' },
    ],
    board,
    finished: ['s1', 's2', 's3', 's4'],
    students,
  });

  it('EXP-02 one row per student with a finished attempt: scores per test, total and rank matching rankSeries', () => {
    expect(table.columns.slice(5)).toEqual(['Day 1: Quant', 'Day 2: Verbal', 'Total', 'Rank']);
    expect(table.rows.map((r) => [r[0], ...r.slice(5)])).toEqual([
      ['Asha', 3, 2, 5, 1],
      ['Bina', 4, null, 4, 2],
      ['Dev', null, 1, 1, 3],
      ['Chirag', null, null, 0, null],
    ]);
    expect(table.rows[0]!.slice(0, 5)).toEqual(['Asha', 's1@a.test', '22010101', 'Computer Engineering', 2026]);
  });

  it('EXP-02 students off the board are listed by name after the board rows', () => {
    const off = seriesExportTable({ tests: [], board: [], finished: ['s3', 's1', 's2'], students });
    expect(off.rows.map((r) => [r[0], r[5], r[6]])).toEqual([
      ['Asha', 0, null],
      ['Bina', 0, null],
      ['Chirag', 0, null],
    ]);
  });
});
