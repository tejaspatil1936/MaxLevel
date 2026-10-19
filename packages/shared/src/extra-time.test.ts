import { describe, expect, it } from 'vitest';
import {
  extensionNotice,
  extraTimeGrantSchema,
  extraTimeNeedsConfirmation,
  isGrantMinutes,
  MAX_EXTRA_MINUTES,
  signalPath,
  signalRecordSchema,
} from './extra-time';

describe('extra time', () => {
  it('OPS-06 the notice names the minutes, with one minute singular', () => {
    expect(extensionNotice(10)).toBe('Your time was extended by 10 minutes.');
    expect(extensionNotice(1)).toBe('Your time was extended by 1 minute.');
  });

  it('OPS-08 only a grant above the duration needs a second confirmation', () => {
    expect(extraTimeNeedsConfirmation(61, 60)).toBe(true);
    expect(extraTimeNeedsConfirmation(60, 60)).toBe(false);
    expect(extraTimeNeedsConfirmation(10, 60)).toBe(false);
  });

  it('US-AD-12 a grant is whole minutes from 1 to 1,440 with a reason that is not blank', () => {
    const ok = (body: object) => extraTimeGrantSchema.safeParse(body).success;
    expect(ok({ minutes: 10, reason: 'Power cut' })).toBe(true);
    expect(ok({ minutes: MAX_EXTRA_MINUTES, reason: 'Long', confirmOverDuration: true })).toBe(true);
    expect(ok({ minutes: 10 })).toBe(false);
    expect(ok({ minutes: 10, reason: '   ' })).toBe(false);
    expect(ok({ minutes: 0, reason: 'Zero' })).toBe(false);
    expect(ok({ minutes: 2.5, reason: 'Half' })).toBe(false);
    expect(ok({ minutes: 1441, reason: 'Too long' })).toBe(false);
    expect(extraTimeGrantSchema.parse({ minutes: 5, reason: '  Outage ' }).reason).toBe('Outage');
    expect([1, 1440].every(isGrantMinutes)).toBe(true);
    expect([0, 1441, 2.5, Number.NaN].some(isGrantMinutes)).toBe(false);
  });

  it('OPS-06 the signal record carries the new deadline and the notice', () => {
    expect(signalPath('org-a', 'att-1')).toBe('signals/org-a/att-1');
    expect(signalRecordSchema.safeParse({ deadlineAt: 1, notice: extensionNotice(1) }).success).toBe(true);
    expect(signalRecordSchema.safeParse({ notice: 'x' }).success).toBe(false);
  });
});
