import { describe, expect, it } from 'vitest';
import { lastSeenOf, liveCounts, liveRows, timeLeftOf, type LiveRow } from './live-rows';
import type { LiveRecord } from './live';

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

describe('live rows and counts', () => {
  it('PERF-04 OPS-01 counts come from the live records alone, each student once by the newest record, reset as none', () => {
    const rows = liveRows({
      students,
      secondCamera: true,
      records: {
        a1: rec('s1', { answered: 2 }),
        a2: rec('s2', { status: 'pairing', startedAt: undefined }),
        old: rec('s3', { status: 'terminated', startedAt: NOW - 600_000 }),
        a3: rec('s3', { status: 'submitted' }),
        gone: rec('s4', { status: 'reset' }),
        x9: rec('s9', { status: 'auto_submitted' }),
      },
      presence: { a1: { laptop: laptop(true), phone: phone(true) } },
    });
    expect(rows.map((r) => [r.studentId, r.status])).toEqual([
      ['s1', 'in_progress'],
      ['s2', 'pairing'],
      ['s3', 'submitted'],
      ['s4', 'not_started'],
      ['s9', 'auto_submitted'],
    ]);
    expect(rows[0]).toMatchObject({ answered: 2, total: 4, strikes: 0, phone: 'connected', attemptId: 'a1' });
    expect(rows[1]).toMatchObject({ answered: null, strikes: null, phone: 'disconnected' });
    expect(rows[2]).toMatchObject({ phone: null, attemptId: 'a3' });
    expect(rows[4]).toMatchObject({ name: 'Former', prn: 'PX' });
    expect(liveCounts(rows, students.length)).toEqual({
      eligible: 4,
      not_started: 1,
      pairing: 1,
      in_progress: 1,
      submitted: 1,
      auto_submitted: 1,
      terminated: 0,
    });
  });

  it('OPS-01 without a second camera the phone is not used; last seen and time left only while in progress', () => {
    const [inProgress, submitted] = liveRows({
      students: students.slice(0, 2),
      secondCamera: false,
      records: { a1: rec('s1'), a2: rec('s2', { status: 'submitted' }) },
      presence: { a1: { laptop: laptop(false, NOW - 75_000) } },
    }) as [LiveRow, LiveRow];
    expect(inProgress.phone).toBe('not_used');
    expect(lastSeenOf(inProgress, NOW)).toEqual({ kind: 'ago', ms: 75_000 });
    expect(lastSeenOf({ ...inProgress, laptop: null }, NOW)).toEqual({ kind: 'not_seen' });
    expect(lastSeenOf({ ...inProgress, laptop: { online: true, lastSeen: 0 } }, NOW)).toEqual({ kind: 'online' });
    expect(timeLeftOf(inProgress, NOW)).toBe(30 * 60_000);
    expect(timeLeftOf(inProgress, NOW + 31 * 60_000)).toBe(0);
    expect(lastSeenOf(submitted, NOW)).toBeNull();
    expect(timeLeftOf(submitted, NOW)).toBeNull();
  });
});
