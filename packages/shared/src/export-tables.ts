import type { AttemptResult, AttemptStatus } from './attempt';
import { csvLine } from './csv';
import { EXPORT_STATUS_WORDS, exportDateTime, TERMINATION_WORDS, testExportColumns } from './exports';

// The tables of the results exports (EXP-01, EXP-02), built from stored records by the worker and written as CSV here
// or as XLSX by the worker. Rows follow the stored boards' ranks (LB-01, LB-02).

/** A cell: numbers stay numeric (XLSX number cells), null is an empty cell, everything else is text. */
export type ExportCell = string | number | null;
export interface ExportTable {
  columns: string[];
  rows: ExportCell[][];
}

/** The profile fields of a student, with the department's name. */
export interface ExportStudent {
  name: string;
  email: string;
  prn: string;
  department: string;
  graduationYear: number | null;
}

/** What the test export reads of a stored attempt. */
export interface ExportAttempt {
  studentId: string;
  status: AttemptStatus;
  startedAt: number;
  submittedAt?: number;
  strikesCount: number;
  terminationReason?: string;
  extraTimeSec: number;
  result?: Pick<AttemptResult, 'score' | 'max' | 'pct' | 'correct' | 'incorrect' | 'unanswered' | 'durationSec'> & {
    sections?: Record<string, { score: number }>;
  };
}

const byName = new Intl.Collator('en').compare;
const NO_STUDENT: ExportStudent = { name: '', email: '', prn: '', department: '', graduationYear: null };
const person = (s: ExportStudent): ExportCell[] => [s.name, s.email, s.prn, s.department, s.graduationYear];
const RANKED: ReadonlySet<AttemptStatus> = new Set(['submitted', 'auto_submitted']);

/** Ranked entries first by rank (ties by name), then the rest by name. */
function boardOrder<T>(items: T[], rank: (x: T) => number | null, name: (x: T) => string): T[] {
  return [...items].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== null && rb !== null && ra !== rb) return ra - rb;
    if ((ra === null) !== (rb === null)) return ra === null ? 1 : -1;
    return byName(name(a), name(b));
  });
}

export interface TestExportInput {
  sections: ReadonlyArray<{ id: string; name: string }>;
  attempts: ReadonlyArray<ExportAttempt>;
  students: ReadonlyMap<string, ExportStudent>;
  /** Rank per student ID on the stored test board. */
  ranks: ReadonlyMap<string, number>;
  timeZone: string;
  /** The zone's short name for the time headers (`IST`). */
  zone: string;
}

/** EXP-01: one row per attempt that is not `reset`, ranked rows first in rank order, then the rest by name. */
export function testExportTable(input: TestExportInput): ExportTable {
  const rows = input.attempts
    .filter((a) => a.status !== 'reset')
    .map((a) => ({
      a,
      student: input.students.get(a.studentId) ?? NO_STUDENT,
      rank: RANKED.has(a.status) ? (input.ranks.get(a.studentId) ?? null) : null,
    }));
  const at = (ms: number | undefined) => (ms === undefined ? null : exportDateTime(ms, input.timeZone));
  return {
    columns: testExportColumns(input.sections, input.zone),
    rows: boardOrder(
      rows,
      (r) => r.rank,
      (r) => r.student.name,
    ).map(({ a, student, rank }) => {
      const r = a.result;
      const terminated = a.status === 'terminated';
      return [
        ...person(student),
        EXPORT_STATUS_WORDS[a.status as Exclude<AttemptStatus, 'reset'>],
        r?.score ?? null,
        r?.max ?? null,
        r ? Math.round(r.pct * 100) / 100 : null,
        rank,
        ...input.sections.map((s) => r?.sections?.[s.id]?.score ?? null),
        r?.correct ?? null,
        r?.incorrect ?? null,
        r?.unanswered ?? null,
        at(a.startedAt),
        at(a.submittedAt),
        r?.durationSec ?? null,
        a.strikesCount,
        terminated ? (TERMINATION_WORDS[a.terminationReason ?? ''] ?? a.terminationReason ?? null) : null,
        a.extraTimeSec / 60,
      ];
    }),
  };
}

/** The CSV file of a table: UTF-8 with a byte order mark, RFC 4180 quoting, CRLF line ends, header row first. */
export function exportCsv(table: ExportTable): string {
  return `\uFEFF${[table.columns, ...table.rows].map(csvLine).join('\r\n')}\r\n`;
}
