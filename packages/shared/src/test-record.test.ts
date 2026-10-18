import { describe, expect, it } from 'vitest';
import { testCreateSchema, testPatchSchema, testStatusAt } from './test-record';

const window = { start: 1_000, end: 2_000 };

describe('testStatusAt', () => {
  it('TST-04 a scheduled test is live inside its window and closed after it, scheduled before it', () => {
    expect(testStatusAt('scheduled', window, 999)).toBe('scheduled');
    expect(testStatusAt('scheduled', window, 1_000)).toBe('live');
    expect(testStatusAt('scheduled', window, 1_999)).toBe('live');
    expect(testStatusAt('scheduled', window, 2_000)).toBe('closed');
  });

  it('TST-04 tests that are not scheduled keep their stored status, whatever the clock', () => {
    for (const s of ['draft', 'in_review', 'approved'] as const) expect(testStatusAt(s, window, 1_500)).toBe(s);
    expect(testStatusAt('scheduled', null, 1_500)).toBe('scheduled');
  });
});

describe('test request schemas', () => {
  it('TST-01 a new test needs a title and a real date; company and day number are optional', () => {
    const ok = testCreateSchema.parse({ seriesId: 's1', title: ' Aptitude ', scheduledDate: '2026-11-03' });
    expect(ok).toEqual({ seriesId: 's1', title: 'Aptitude', scheduledDate: '2026-11-03', dayHidden: false });
    expect(testCreateSchema.safeParse({ seriesId: 's1', title: ' ', scheduledDate: '2026-11-03' }).success).toBe(false);
    expect(testCreateSchema.safeParse({ seriesId: 's1', title: 'A', scheduledDate: '2026-11-31' }).success).toBe(false);
  });

  it('TST-04 the status is never set through PATCH', () => {
    expect(testPatchSchema.safeParse({ status: 'scheduled' }).success).toBe(false);
    expect(testPatchSchema.safeParse({ title: 'Aptitude', status: 'approved' }).success).toBe(false);
    expect(testPatchSchema.safeParse({ dayNumber: 'Mock 1', dayHidden: true }).success).toBe(true);
  });
});
