import { describe, expect, it } from 'vitest';
import {
  formatCountdown,
  formatExamTimer,
  formatQuestionTimer,
  formatDay,
  formatMarking,
  formatMinutes,
  formatWindow,
  formatZonedDay,
  formatZonedTime,
  parseMinutes,
  zonedParts,
  zoneName,
} from './format';

describe('authoring formats', () => {
  it('SER-01 calendar dates read d MMM yyyy and daily times HH:mm in the org zone named IST', () => {
    expect(formatDay('2026-11-01')).toBe('1 Nov 2026');
    expect(formatDay('2026-09-30')).toBe('30 Sep 2026');
    expect(formatMinutes(540)).toBe('09:00');
    expect(formatMinutes(1080)).toBe('18:00');
    expect(parseMinutes('09:05')).toBe(545);
    expect(parseMinutes('')).toBeNull();
    expect(parseMinutes('25:00')).toBeNull();
    expect(zoneName('Asia/Kolkata', Date.UTC(2026, 10, 1))).toBe('IST');
  });

  it('TST-07 a stored UTC window reads in the org timezone with the zone named, whatever the device zone', () => {
    const w = { start: Date.UTC(2026, 10, 2, 4, 30), end: Date.UTC(2026, 10, 2, 5, 30) };
    expect(formatWindow(w, 'Asia/Kolkata')).toBe('2 Nov 2026, 10:00 to 11:00 IST');
    expect(zonedParts(Date.UTC(2026, 10, 2, 20, 0), 'Asia/Kolkata')).toEqual({ day: '2026-11-03', time: '01:30' });
    const overnight = { start: Date.UTC(2026, 10, 2, 17, 30), end: Date.UTC(2026, 10, 2, 19, 30) };
    expect(formatWindow(overnight, 'Asia/Kolkata')).toBe('2 Nov 2026, 23:00 to 3 Nov 2026, 01:00 IST');
  });
});

describe('student formats', () => {
  it('UX-11 countdowns read HH:MM:SS, then 1 day and n days', () => {
    expect(formatCountdown(5 * 60_000)).toBe('00:05:00');
    expect(formatCountdown(-1)).toBe('00:00:00');
    expect(formatCountdown(86_399_999)).toBe('23:59:59');
    expect(formatCountdown(86_400_000 + 61_000)).toBe('1 day 00:01:01');
    expect(formatCountdown((2 * 1440 + 210) * 60_000)).toBe('2 days 03:30:00');
  });

  it('EX-06 the exam timer reads MM:SS below one hour and H:MM:SS from one hour', () => {
    expect(formatExamTimer(41 * 60_000 + 58_999)).toBe('41:58');
    expect(formatExamTimer(9 * 60_000 + 59_000)).toBe('09:59');
    expect(formatExamTimer(3_600_000)).toBe('1:00:00');
    expect(formatExamTimer(-5)).toBe('00:00');
  });

  it('Q-11 the per-question timer reads M:SS', () => {
    expect(formatQuestionTimer(20_000)).toBe('0:20');
    expect(formatQuestionTimer(19_999)).toBe('0:19');
    expect(formatQuestionTimer(65_000)).toBe('1:05');
    expect(formatQuestionTimer(-1)).toBe('0:00');
  });

  it('UX-11 TST-07 times a student acts on read HH:mm in the org zone with the zone named', () => {
    const at = Date.UTC(2026, 10, 4, 7, 30);
    expect(formatZonedTime(at, 'Asia/Kolkata')).toBe('13:00 IST');
    expect(formatZonedDay(Date.UTC(2026, 10, 4, 19, 0), 'Asia/Kolkata')).toBe('5 Nov 2026');
  });

  it('US-ST-03 marking reads +marks, a U+2212 deduction or 0, and 0 for no answer', () => {
    expect(formatMarking({ marks: 4, negativeMarks: 1 })).toBe(
      '+4 for a correct answer, \u22121 for a wrong answer, 0 for no answer',
    );
    expect(formatMarking({ marks: 1, negativeMarks: 0.25 })).toContain('\u22120.25 for a wrong answer');
    expect(formatMarking({ marks: 1, negativeMarks: 0 })).toBe(
      '+1 for a correct answer, 0 for a wrong answer, 0 for no answer',
    );
  });
});
