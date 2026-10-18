import { describe, expect, it } from 'vitest';
import { formatDay, formatMinutes, parseMinutes, zoneName } from './format';

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
});
