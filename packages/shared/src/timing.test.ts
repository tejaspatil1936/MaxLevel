import { describe, expect, it } from 'vitest';
import { attemptDeadline, canStart, lastStartAt, questionTimeLimit, questionTimeUpAt, sectionDeadline } from './timing';

const MIN = 60_000;
const start = Date.UTC(2026, 10, 2, 4, 30); // 2 Nov 2026, 10:00 IST
const window = { start, end: start + 60 * MIN };

const fixed = {
  timingMode: 'fixed',
  window,
  durationMin: 60,
  lateEntryCutoffMin: 15,
  windowEndPolicy: 'full_duration',
} as const;
const fullDuration = { ...fixed, timingMode: 'flexible', window: { start, end: start + 180 * MIN } } as const;
const hardClose = { ...fullDuration, windowEndPolicy: 'hard_close' } as const;

describe('canStart and lastStartAt', () => {
  it('TST-08 fixed slot: from slot start to slot start + late entry cutoff, both inclusive', () => {
    expect(lastStartAt(fixed)).toBe(start + 15 * MIN);
    expect(canStart(fixed, start - 1)).toEqual({ ok: false, code: 'WINDOW_NOT_OPEN' });
    expect(canStart(fixed, start)).toEqual({ ok: true });
    expect(canStart(fixed, start + 15 * MIN)).toEqual({ ok: true });
    expect(canStart(fixed, start + 15 * MIN + 1)).toEqual({ ok: false, code: 'WINDOW_CLOSED' });
    expect(canStart(fixed, window.end + MIN)).toEqual({ ok: false, code: 'WINDOW_CLOSED' });
  });

  it('TST-08 fixed slot: a cutoff longer than the slot ends at the slot end', () => {
    const long = { ...fixed, lateEntryCutoffMin: 90 };
    expect(lastStartAt(long)).toBe(window.end);
    expect(canStart(long, window.end + 1)).toEqual({ ok: false, code: 'WINDOW_CLOSED' });
  });

  it('TST-08 flexible full duration: from window start to window end − duration, both inclusive', () => {
    const last = start + 120 * MIN;
    expect(lastStartAt(fullDuration)).toBe(last);
    expect(canStart(fullDuration, start - 1)).toEqual({ ok: false, code: 'WINDOW_NOT_OPEN' });
    expect(canStart(fullDuration, start)).toEqual({ ok: true });
    expect(canStart(fullDuration, last)).toEqual({ ok: true });
    expect(canStart(fullDuration, last + 1)).toEqual({ ok: false, code: 'WINDOW_CLOSED' });
  });

  it('TST-08 flexible hard close: from window start to strictly before window end', () => {
    const end = fullDuration.window.end;
    expect(lastStartAt(hardClose)).toBe(end);
    expect(canStart(hardClose, start - 1)).toEqual({ ok: false, code: 'WINDOW_NOT_OPEN' });
    expect(canStart(hardClose, start)).toEqual({ ok: true });
    expect(canStart(hardClose, end - 1)).toEqual({ ok: true });
    expect(canStart(hardClose, end)).toEqual({ ok: false, code: 'WINDOW_CLOSED' });
  });

  it('TST-08 a test without a window never opens', () => {
    expect(canStart({ ...fixed, window: null }, start)).toEqual({ ok: false, code: 'WINDOW_NOT_OPEN' });
    expect(() => lastStartAt({ ...fixed, window: null })).toThrow();
  });

  it('OPS-10 TST-07 after a reset a start is open past the late-entry cutoff until strictly before the window end', () => {
    const afterReset = { afterReset: true };
    expect(lastStartAt(fixed, afterReset)).toBe(window.end);
    expect(canStart(fixed, start + 20 * MIN, afterReset)).toEqual({ ok: true });
    expect(canStart(fixed, window.end - 1, afterReset)).toEqual({ ok: true });
    expect(canStart(fixed, window.end, afterReset)).toEqual({ ok: false, code: 'WINDOW_CLOSED' });
    expect(canStart(fixed, start - 1, afterReset)).toEqual({ ok: false, code: 'WINDOW_NOT_OPEN' });
    const end = fullDuration.window.end;
    expect(canStart(fullDuration, start + 150 * MIN, afterReset)).toEqual({ ok: true });
    expect(canStart(fullDuration, end, afterReset)).toEqual({ ok: false, code: 'WINDOW_CLOSED' });
    expect(canStart(hardClose, end - 1, afterReset)).toEqual({ ok: true });
    // The deadline still follows the timing mode: a fixed slot ends at the slot end.
    expect(attemptDeadline(fixed, start + 20 * MIN)).toBe(window.end);
  });
});

describe('attemptDeadline', () => {
  it('TST-08 fixed slot: the slot end, so a latecomer gets only the time left', () => {
    expect(attemptDeadline(fixed, start)).toBe(window.end);
    expect(attemptDeadline(fixed, start + 10 * MIN)).toBe(window.end);
  });

  it('TST-08 flexible full duration: start + duration, even past the window end', () => {
    expect(attemptDeadline(fullDuration, start + 5 * MIN)).toBe(start + 65 * MIN);
    expect(attemptDeadline(fullDuration, start + 150 * MIN)).toBe(start + 210 * MIN);
  });

  it('TST-08 flexible hard close: the earlier of start + duration and the window end', () => {
    const end = hardClose.window.end;
    expect(attemptDeadline(hardClose, start + 5 * MIN)).toBe(start + 65 * MIN);
    expect(attemptDeadline(hardClose, end - 20 * MIN)).toBe(end);
  });

  it('TST-08 extra time is added on top in every mode', () => {
    expect(attemptDeadline(fixed, start, 600)).toBe(window.end + 10 * MIN);
    expect(attemptDeadline(fullDuration, start, 90)).toBe(start + 60 * MIN + 90_000);
    expect(attemptDeadline(hardClose, hardClose.window.end - MIN, 300)).toBe(hardClose.window.end + 5 * MIN);
  });
});

describe('sectionDeadline', () => {
  const deadline = start + 60 * MIN;

  it('TST-08 a section timer is its start plus its duration', () => {
    expect(sectionDeadline(start + 10 * MIN, 20, deadline)).toBe(start + 30 * MIN);
  });

  it('TST-08 a section timer never runs past the attempt deadline', () => {
    expect(sectionDeadline(start + 50 * MIN, 20, deadline)).toBe(deadline);
    expect(sectionDeadline(start, 60, deadline)).toBe(deadline);
  });

  it('TST-08 a section without a duration runs to the attempt deadline', () => {
    expect(sectionDeadline(start + 10 * MIN, undefined, deadline)).toBe(deadline);
  });
});

describe('questionTimeLimit and questionTimeUpAt', () => {
  it('Q-10 Q-11 the limit is the test’s with same, the question’s own with each, and none without timers', () => {
    expect(questionTimeLimit({ questionTimeMode: 'same', questionTimeLimitSec: 20 }, { timeLimitSec: 90 })).toBe(20);
    expect(questionTimeLimit({ questionTimeMode: 'each', questionTimeLimitSec: 20 }, { timeLimitSec: 90 })).toBe(90);
    expect(questionTimeLimit({ questionTimeMode: 'each' }, {})).toBeUndefined();
    expect(questionTimeLimit({ questionTimeMode: 'none', questionTimeLimitSec: 20 }, { timeLimitSec: 90 })).toBe(
      undefined,
    );
  });

  it('Q-11 a timed question’s time ends its limit after it was first served', () => {
    expect(questionTimeUpAt(start, 20)).toBe(start + 20_000);
  });
});
