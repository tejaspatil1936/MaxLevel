import { describe, expect, it } from 'vitest';
import { formatDay, formatMinutes, formatWindow, parseMinutes, zonedParts, zoneName } from './format';

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
