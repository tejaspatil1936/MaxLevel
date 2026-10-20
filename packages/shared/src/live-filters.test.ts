import { describe, expect, it } from 'vitest';
import type { LiveRecord } from './live';
import { matchesLiveFilter, matchesLiveSearch, sortLiveRows } from './live-filters';
import { liveRows } from './live-rows';

const NOW = 1_793_592_000_000;
const students = [
  { id: 's1', name: 'Aarav', prn: 'P01' },
  { id: 's2', name: 'Rohan', prn: 'P02' },
  { id: 's3', name: 'Vihaan', prn: 'P03' },
  { id: 's4', name: 'Yash', prn: 'P04' },
];
const rec = (studentId: string, patch: Partial<LiveRecord> = {}): LiveRecord => ({
  studentId,
  name: students.find((s) => s.id === studentId)?.name ?? 'Former',
  prn: 'PX',
  status: 'in_progress',
  answered: 0,
  total: 4,
  strikes: 0,
  deadlineAt: NOW + 30 * 60_000,
  startedAt: NOW - 120_000,
  updatedAt: NOW,
  ...patch,
});
const laptop = (online: boolean, lastSeen = NOW) => ({ online, lastSeen, fullscreen: true, visible: true });
const phone = (online: boolean) => ({ online, lastSeen: NOW, cameraOn: true });

describe('live filters', () => {
  it('OPS-03 each filter keeps its rows, and search matches name or PRN ignoring case', () => {
    const rows = liveRows({
      students,
      secondCamera: true,
      records: {
        a1: rec('s1'),
        a2: rec('s2', { strikes: 1 }),
        a3: rec('s3', { status: 'terminated', strikes: 3 }),
      },
      presence: { a1: { laptop: laptop(true), phone: phone(true) } },
    });
    const kept = (f: Parameters<typeof matchesLiveFilter>[1]) =>
      rows.filter((r) => matchesLiveFilter(r, f, NOW)).map((r) => r.studentId);
    expect(kept('with_strikes')).toEqual(['s2', 's3']);
    expect(kept('phone_disconnected')).toEqual(['s2']);
    expect(kept('offline')).toEqual(['s2']);
    expect(kept('not_started')).toEqual(['s4']);
    expect(kept('terminated')).toEqual(['s3']);
    expect(rows.filter((r) => matchesLiveSearch(r, 'vIH')).map((r) => r.studentId)).toEqual(['s3']);
    expect(rows.filter((r) => matchesLiveSearch(r, 'p04')).map((r) => r.studentId)).toEqual(['s4']);
  });
});

describe('live sorting', () => {
  const rows = liveRows({
    students,
    secondCamera: false,
    records: {
      a1: rec('s1', { answered: 2 }),
      a2: rec('s2', { strikes: 1, deadlineAt: NOW + 60_000 }),
      a3: rec('s3', { status: 'terminated', strikes: 3 }),
    },
    presence: { a1: { laptop: laptop(true) }, a2: { laptop: laptop(false, NOW - 5_000) } },
  });
  const order = (key: Parameters<typeof sortLiveRows>[1]['key'], dir: 'asc' | 'desc') =>
    sortLiveRows(rows, { key, dir }, NOW).map((r) => r.name);

  it('OPS-03 sorts ascending and descending with empty cells last and ties by name A to Z', () => {
    expect(order('student', 'asc')).toEqual(['Aarav', 'Rohan', 'Vihaan', 'Yash']);
    expect(order('student', 'desc')).toEqual(['Yash', 'Vihaan', 'Rohan', 'Aarav']);
    expect(order('strikes', 'asc')).toEqual(['Aarav', 'Rohan', 'Vihaan', 'Yash']);
    expect(order('strikes', 'desc')).toEqual(['Vihaan', 'Rohan', 'Aarav', 'Yash']);
    expect(order('answered', 'desc')).toEqual(['Aarav', 'Rohan', 'Vihaan', 'Yash']);
    expect(order('status', 'asc')).toEqual(['Yash', 'Aarav', 'Rohan', 'Vihaan']);
    expect(order('lastSeen', 'asc')).toEqual(['Aarav', 'Rohan', 'Vihaan', 'Yash']);
    expect(order('timeLeft', 'asc')).toEqual(['Rohan', 'Aarav', 'Vihaan', 'Yash']);
    expect(order('timeLeft', 'desc')).toEqual(['Aarav', 'Rohan', 'Vihaan', 'Yash']);
  });
});
