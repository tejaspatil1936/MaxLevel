import { describe, expect, it } from 'vitest';
import { LATE_SYNC_GRACE_MS, QUESTION_TIME_GRACE_MS, answerVerdict, retryDelayMs } from './sync';

describe('retryDelayMs', () => {
  it('EX-12 retries wait 1, 2, 4 and 8 seconds, then every 15 seconds', () => {
    expect([1, 2, 3, 4, 5, 6, 20].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
    expect(retryDelayMs(0), 'no failure, no wait').toBe(0);
  });
});

describe('answerVerdict', () => {
  const deadlineAt = 1_793_592_000_000;
  const base = { seq: 2, clientTs: deadlineAt - 60_000, serverNow: deadlineAt - 59_000, deadlineAt };

  it('EX-11 an answer is saved only when its seq is higher than the stored one', () => {
    expect(answerVerdict(base)).toBe('saved');
    expect(answerVerdict({ ...base, storedSeq: 1 })).toBe('saved');
    expect(answerVerdict({ ...base, storedSeq: 2 })).toBe('stale');
    expect(answerVerdict({ ...base, storedSeq: 5 })).toBe('stale');
  });

  it('EX-13 an answer made before the deadline arriving within 2 minutes after it is a late sync', () => {
    expect(LATE_SYNC_GRACE_MS).toBe(120_000);
    const late = { ...base, clientTs: deadlineAt - 1000 };
    expect(answerVerdict({ ...late, serverNow: deadlineAt })).toBe('saved');
    expect(answerVerdict({ ...late, clientTs: deadlineAt, serverNow: deadlineAt + 1 })).toBe('late_sync');
    expect(answerVerdict({ ...late, serverNow: deadlineAt + LATE_SYNC_GRACE_MS })).toBe('late_sync');
  });

  it('EX-13 an answer made after the deadline, or arriving more than 2 minutes after it, is AFTER_DEADLINE', () => {
    expect(answerVerdict({ ...base, clientTs: deadlineAt + 1, serverNow: deadlineAt + 5000 })).toBe('AFTER_DEADLINE');
    expect(answerVerdict({ ...base, serverNow: deadlineAt + LATE_SYNC_GRACE_MS + 1 })).toBe('AFTER_DEADLINE');
  });

  it('Q-12 a timed question never served is QUESTION_NOT_SERVED', () => {
    expect(answerVerdict({ ...base, timeLimitSec: 20 })).toBe('QUESTION_NOT_SERVED');
  });

  it('Q-12 a timed question accepts answers up to its limit plus 2 seconds after it was first served', () => {
    expect(QUESTION_TIME_GRACE_MS).toBe(2000);
    const servedAt = base.serverNow - 30_000;
    const timed = { ...base, servedAt, timeLimitSec: 20 };
    expect(answerVerdict({ ...timed, serverNow: servedAt + 22_000 })).toBe('saved');
    expect(answerVerdict({ ...timed, serverNow: servedAt + 22_001 })).toBe('QUESTION_TIME_UP');
  });

  it('EX-11 Q-12 a retried answer that is already stored reads as stale, not rejected', () => {
    const servedAt = base.serverNow - 30_000;
    expect(answerVerdict({ ...base, storedSeq: 2, servedAt, timeLimitSec: 20 })).toBe('stale');
    expect(answerVerdict({ ...base, storedSeq: 2, serverNow: deadlineAt + LATE_SYNC_GRACE_MS + 1 })).toBe('stale');
  });
});
