import { describe, expect, it } from 'vitest';
import { isFinalMinutes, passedWarning, timeLeftText, warningText } from './time-left';

const MIN = 60_000;

describe('exam time left', () => {
  it('EX-06 the timer is red pen below 10 minutes and not before', () => {
    expect(isFinalMinutes(10 * MIN)).toBe(false);
    expect(isFinalMinutes(58 * MIN)).toBe(false);
    expect(isFinalMinutes(10 * MIN - 1)).toBe(true);
    expect(isFinalMinutes(0)).toBe(true);
  });

  it('A11Y-09 a warning is given once as the time left passes 10, 5 and 1 minutes, never every second', () => {
    expect(passedWarning(10 * MIN + 1000, 10 * MIN)).toBe(10);
    expect(passedWarning(11 * MIN, 9 * MIN + 58_000)).toBe(10);
    expect(passedWarning(9 * MIN + 58_000, 9 * MIN + 57_000)).toBeNull();
    expect(passedWarning(5 * MIN + 2000, 4 * MIN + 58_000)).toBe(5);
    expect(passedWarning(MIN + 500, 58_000)).toBe(1);
    expect(passedWarning(58_000, 53_000)).toBeNull();
    expect(passedWarning(30 * MIN, 29 * MIN)).toBeNull();
    // A jump past several warnings gives the last one only.
    expect(passedWarning(11 * MIN, 30_000)).toBe(1);
    expect(warningText(10)).toBe('10 minutes left');
    expect(warningText(5)).toBe('5 minutes left');
    expect(warningText(1)).toBe('1 minute left');
  });

  it('A11Y-06 T reads whole minutes rounded down, or seconds under one minute', () => {
    expect(timeLeftText(57 * MIN + 59_999)).toBe('57 minutes left');
    expect(timeLeftText(2 * MIN)).toBe('2 minutes left');
    expect(timeLeftText(MIN + 30_000)).toBe('1 minute left');
    expect(timeLeftText(59_999)).toBe('59 seconds left');
    expect(timeLeftText(1500)).toBe('1 second left');
    expect(timeLeftText(-5000)).toBe('0 seconds left');
  });
});
