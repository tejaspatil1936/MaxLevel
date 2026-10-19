import { LIVE_ROW_STATUSES, type LiveRecord, type LiveRowStatus } from './live';
import type { LaptopPresence, PhonePresence } from './pairing';

// The live view's rows (spec 8.3; OPS-01, OPS-03, PERF-04; docs/testids/phase-5.md "Live view"): how the browser turns
// the live records and presence of a test into rows, counts, filters and sort orders, with no API call per update.

export interface LivePresence {
  laptop?: LaptopPresence | null;
  phone?: PhonePresence | null;
}

export type PhoneState = 'connected' | 'disconnected' | 'not_used';

export interface LiveRow {
  studentId: string;
  name: string;
  prn: string;
  status: LiveRowStatus;
  attemptId: string | null;
  /** Answered, total and strikes are null for `not_started` and `pairing`. */
  answered: number | null;
  total: number | null;
  strikes: number | null;
  /** Null where the `Phone` cell is empty. */
  phone: PhoneState | null;
  laptop: { online: boolean; lastSeen: number } | null;
  startedAt: number | null;
  deadlineAt: number | null;
}

const recency = (r: LiveRecord) => r.startedAt ?? r.updatedAt;

/**
 * One row per eligible student, plus one per student with a live record who is no longer eligible. Each student is
 * shown by their newest record; a `reset` record counts as none.
 */
export function liveRows(input: {
  students: Array<{ id: string; name: string; prn: string }>;
  records: Record<string, LiveRecord>;
  presence: Record<string, LivePresence>;
  secondCamera: boolean;
}): LiveRow[] {
  const newest = new Map<string, { attemptId: string; record: LiveRecord }>();
  for (const [attemptId, record] of Object.entries(input.records)) {
    if (record.status === 'reset') continue;
    const seen = newest.get(record.studentId);
    if (!seen || recency(record) > recency(seen.record)) newest.set(record.studentId, { attemptId, record });
  }
  const row = (student: { id: string; name: string; prn: string }): LiveRow => {
    const found = newest.get(student.id);
    const base = { studentId: student.id, name: student.name, prn: student.prn };
    if (!found)
      return {
        ...base,
        status: 'not_started',
        attemptId: null,
        answered: null,
        total: null,
        strikes: null,
        phone: null,
        laptop: null,
        startedAt: null,
        deadlineAt: null,
      };
    const { attemptId, record } = found;
    const status = record.status as Exclude<LiveRowStatus, 'not_started'>;
    const presence = input.presence[attemptId] ?? {};
    const started = status !== 'pairing';
    const watched = status === 'pairing' || status === 'in_progress';
    return {
      ...base,
      status,
      attemptId,
      answered: started ? (record.answered ?? 0) : null,
      total: started ? (record.total ?? 0) : null,
      strikes: started ? (record.strikes ?? 0) : null,
      phone: !watched
        ? null
        : !input.secondCamera
          ? 'not_used'
          : presence.phone?.online === true
            ? 'connected'
            : 'disconnected',
      laptop: presence.laptop ? { online: presence.laptop.online, lastSeen: presence.laptop.lastSeen } : null,
      startedAt: record.startedAt ?? null,
      deadlineAt: record.deadlineAt ?? null,
    };
  };
  const eligible = new Set(input.students.map((s) => s.id));
  const others = [...newest.values()]
    .filter(({ record }) => !eligible.has(record.studentId))
    .map(({ record }) => ({ id: record.studentId, name: record.name, prn: record.prn }));
  return [...input.students, ...others].map(row);
}

export type LiveCounts = { eligible: number } & Record<LiveRowStatus, number>;

/** The seven counts across the top (OPS-01), from the rows alone: no query per update (PERF-04). */
export function liveCounts(rows: LiveRow[], eligible: number): LiveCounts {
  const counts = Object.fromEntries(LIVE_ROW_STATUSES.map((s) => [s, 0])) as Record<LiveRowStatus, number>;
  for (const r of rows) counts[r.status] += 1;
  return { eligible, ...counts };
}

/** The `Last seen` cell of an attempt in progress; null (empty) for every other status. */
export type LastSeen = { kind: 'online' } | { kind: 'ago'; ms: number } | { kind: 'not_seen' };
export function lastSeenOf(row: LiveRow, now: number): LastSeen | null {
  if (row.status !== 'in_progress') return null;
  if (!row.laptop) return { kind: 'not_seen' };
  if (row.laptop.online) return { kind: 'online' };
  return { kind: 'ago', ms: Math.max(0, now - row.laptop.lastSeen) };
}

/** The `Time left` of an attempt in progress (never below 0); null (empty) for every other status. */
export function timeLeftOf(row: LiveRow, now: number): number | null {
  if (row.status !== 'in_progress' || row.deadlineAt === null) return null;
  return Math.max(0, row.deadlineAt - now);
}
