import { describe, expect, it } from 'vitest';
import { answeredCount, isOfflineTooLong, liveRecordSchema } from './live';

const NOW = 1_793_592_000_000;
const rec = { studentId: 's1', name: 'Aarav', prn: 'P01', status: 'in_progress', updatedAt: NOW };

describe('live records', () => {
  it('OPS-02 a live record needs the student, name, PRN, a known status and its update time', () => {
    expect(liveRecordSchema.safeParse(rec).success).toBe(true);
    expect(liveRecordSchema.safeParse({ ...rec, status: 'paused' }).success).toBe(false);
    expect(liveRecordSchema.safeParse({ status: 'in_progress', updatedAt: NOW }).success).toBe(false);
  });

  it('OPS-02 answered counts drawn questions with a saved non-null answer', () => {
    expect(
      answeredCount(['q1', 'q2', 'q3'], { q1: { optionId: 'a' }, q2: { optionId: null }, q9: { optionId: 'b' } }),
    ).toBe(1);
  });

  it('OPS-03 offline for more than 60 s: in progress, laptop not online for over a minute or never seen since an old start', () => {
    const base = { status: 'in_progress' as const, now: NOW };
    expect(isOfflineTooLong({ ...base, laptop: { online: false, lastSeen: NOW - 60_001 } })).toBe(true);
    expect(isOfflineTooLong({ ...base, laptop: { online: false, lastSeen: NOW - 60_000 } })).toBe(false);
    expect(isOfflineTooLong({ ...base, laptop: { online: true, lastSeen: NOW - 600_000 } })).toBe(false);
    expect(isOfflineTooLong({ ...base, laptop: null, startedAt: NOW - 61_000 })).toBe(true);
    expect(isOfflineTooLong({ ...base, startedAt: NOW - 30_000 })).toBe(false);
    expect(isOfflineTooLong({ ...base, status: 'terminated', startedAt: NOW - 600_000 })).toBe(false);
  });
});
