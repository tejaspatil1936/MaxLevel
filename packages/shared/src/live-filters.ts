import { isOfflineTooLong, LIVE_ROW_STATUSES } from './live';
import { lastSeenOf, timeLeftOf, type LiveRow, type PhoneState } from './live-rows';

// The live view's filters, search and sorting (OPS-03; docs/testids/phase-5.md "Filters" and "Sorting").

export const LIVE_FILTERS = ['with_strikes', 'phone_disconnected', 'offline', 'not_started', 'terminated'] as const;
export type LiveFilter = (typeof LIVE_FILTERS)[number];

/** Whether a row passes one filter (OPS-03); pressed filters combine with AND. */
export function matchesLiveFilter(row: LiveRow, filter: LiveFilter, now: number): boolean {
  switch (filter) {
    case 'with_strikes':
      return (row.strikes ?? 0) >= 1;
    case 'phone_disconnected':
      return row.phone === 'disconnected';
    case 'offline':
      return isOfflineTooLong({
        status: row.status,
        laptop: row.laptop,
        ...(row.startedAt !== null ? { startedAt: row.startedAt } : {}),
        now,
      });
    default:
      return row.status === filter;
  }
}

/** The search box: name or PRN contains the text, ignoring case. */
export function matchesLiveSearch(row: LiveRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === '' || row.name.toLowerCase().includes(q) || row.prn.toLowerCase().includes(q);
}

export const LIVE_SORT_KEYS = [
  'student',
  'prn',
  'status',
  'answered',
  'strikes',
  'phone',
  'lastSeen',
  'timeLeft',
] as const;
export type LiveSortKey = (typeof LIVE_SORT_KEYS)[number];

const collator = new Intl.Collator('en');
const PHONE_ORDER: PhoneState[] = ['connected', 'disconnected', 'not_used'];

/** A row's value under a sort key; null is an empty cell. */
function sortValue(row: LiveRow, key: LiveSortKey, now: number): string | number | null {
  switch (key) {
    case 'student':
      return row.name;
    case 'prn':
      return row.prn;
    case 'status':
      return LIVE_ROW_STATUSES.indexOf(row.status);
    case 'answered':
      return row.answered;
    case 'strikes':
      return row.strikes;
    case 'phone':
      return row.phone === null ? null : PHONE_ORDER.indexOf(row.phone);
    case 'lastSeen': {
      const seen = lastSeenOf(row, now);
      if (!seen) return null;
      return seen.kind === 'online' ? 0 : seen.kind === 'ago' ? seen.ms : Number.POSITIVE_INFINITY;
    }
    case 'timeLeft':
      return timeLeftOf(row, now);
  }
}

/**
 * Sorting on any column (OPS-03): text by `Intl.Collator('en')`, the rest by number; empty cells last in both
 * directions; ties by name, A to Z, in both directions.
 */
export function sortLiveRows(rows: LiveRow[], sort: { key: LiveSortKey; dir: 'asc' | 'desc' }, now: number) {
  const byName = (a: LiveRow, b: LiveRow) => collator.compare(a.name, b.name) || a.studentId.localeCompare(b.studentId);
  const sign = sort.dir === 'asc' ? 1 : -1;
  return rows
    .map((row) => ({ row, value: sortValue(row, sort.key, now) }))
    .sort((a, b) => {
      if (a.value === null || b.value === null) {
        if (a.value !== b.value) return a.value === null ? 1 : -1;
        return byName(a.row, b.row);
      }
      const cmp =
        typeof a.value === 'string' && typeof b.value === 'string'
          ? collator.compare(a.value, b.value)
          : a.value === b.value
            ? 0
            : a.value < b.value
              ? -1
              : 1;
      return sign * cmp || byName(a.row, b.row);
    })
    .map((x) => x.row);
}
