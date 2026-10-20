import { describe, expect, it } from 'vitest';
import { prewarmAction, prewarmMinInstances, prewarmTask, type PrewarmTarget } from './prewarm';

const START = 1_793_595_600_000;
const END = START + 3_600_000;
const MIN = 60_000;

describe('prewarmTask', () => {
  it('PERF-06 is named for the org, test and window start and scheduled 30 minutes before it, or now', () => {
    const task = prewarmTask({ orgId: 'org-a', testId: 't1', windowStart: START }, START - 3 * 3_600_000);
    expect(task).toEqual({
      name: `prewarm-org-a-t1-${START}`,
      path: '/tasks/prewarm',
      payload: { orgId: 'org-a', testId: 't1', windowStart: START },
      scheduleTime: START - 30 * MIN,
    });
    expect(prewarmTask({ orgId: 'org-a', testId: 't1', windowStart: START }, START - 10 * MIN).scheduleTime).toBe(
      START - 10 * MIN,
    );
    expect(prewarmTask({ orgId: 'org-a', testId: 't1', windowStart: START + MIN }, 0).name).not.toBe(task.name);
  });
});

describe('prewarmMinInstances', () => {
  it('PERF-06 sizes the minimum by eligible students between the usual 2 and the maximum 20', () => {
    expect(prewarmMinInstances(0)).toBe(2);
    expect(prewarmMinInstances(150)).toBe(2);
    expect(prewarmMinInstances(201)).toBe(3);
    expect(prewarmMinInstances(500)).toBe(5);
    expect(prewarmMinInstances(50_000)).toBe(20);
  });
});

describe('prewarmAction', () => {
  const target = (t: Partial<PrewarmTarget> = {}): PrewarmTarget => ({
    status: 'scheduled',
    window: { start: START, end: END },
    prewarmedFor: null,
    ...t,
  });
  it('PERF-06 REL-04 raises a published slot once, and skips a moved, unpublished, ended or missing one', () => {
    expect(prewarmAction(target(), START, START - 30 * MIN)).toBe('raise');
    expect(prewarmAction(target({ prewarmedFor: START }), START, START - 29 * MIN), 'second run').toBe('done');
    expect(prewarmAction(target({ prewarmedFor: START - MIN }), START, START - 30 * MIN)).toBe('raise');
    expect(prewarmAction(target({ window: { start: START + MIN, end: END } }), START, 0), 'rescheduled').toBe('skip');
    for (const status of ['draft', 'in_review', 'approved'])
      expect(prewarmAction(target({ status }), START, 0), status).toBe('skip');
    expect(prewarmAction(target({ window: null }), START, 0)).toBe('skip');
    expect(prewarmAction(target(), START, END), 'slot over').toBe('skip');
    expect(prewarmAction(null, START, 0)).toBe('skip');
  });
});
