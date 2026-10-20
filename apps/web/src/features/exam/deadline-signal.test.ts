import { describe, expect, it } from 'vitest';
import { signalledDeadline } from './deadline-signal';

const MIN = 60_000;
const OPENED = 1_793_592_000_000;
const notice = (n: number) => `Your time was extended by ${n} minutes.`;

describe('extra-time signal on the exam screen', () => {
  it('OPS-06 a later deadline moves the timer and shows its notice until dismissed', () => {
    const signal = { deadlineAt: OPENED + 10 * MIN, notice: notice(10) };
    expect(signalledDeadline(OPENED, null, null)).toEqual({ deadlineAt: OPENED, notice: null });
    expect(signalledDeadline(OPENED, signal, null)).toEqual({ deadlineAt: OPENED + 10 * MIN, notice: notice(10) });
    expect(signalledDeadline(OPENED, signal, OPENED + 10 * MIN)).toEqual({
      deadlineAt: OPENED + 10 * MIN,
      notice: null,
    });
  });

  it('OPS-06 the next grant replaces a dismissed notice; a grant the screen opened with shows none', () => {
    const next = { deadlineAt: OPENED + 11 * MIN, notice: notice(1) };
    expect(signalledDeadline(OPENED, next, OPENED + 10 * MIN)).toEqual({
      deadlineAt: OPENED + 11 * MIN,
      notice: notice(1),
    });
    expect(signalledDeadline(OPENED + 11 * MIN, next, null)).toEqual({ deadlineAt: OPENED + 11 * MIN, notice: null });
    expect(signalledDeadline(OPENED, { deadlineAt: OPENED - MIN, notice: notice(1) }, null).deadlineAt).toBe(OPENED);
  });
});
