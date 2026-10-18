import { describe, expect, it } from 'vitest';
import {
  leaderboardRecomputeTask,
  manualReleaseRefusal,
  releaseResultsTask,
  releaseTaskAction,
  resultReleaseState,
  resultsPublic,
  type ReleaseInput,
} from './release';

const window = { start: 1_000_000, end: 4_600_000 };
const before = window.end - 1;
const after = window.end;
const input = (
  settings: Partial<ReleaseInput['settings']>,
  rest: Omit<ReleaseInput, 'settings'> = {},
): ReleaseInput => ({
  settings: { resultRelease: 'after_close', resultDetail: 'score', timingMode: 'fixed', window, ...settings },
  ...rest,
});

describe('resultReleaseState', () => {
  it('RES-01 immediate is released, after_close and manual wait for resultsReleasedAt, never is never', () => {
    expect(resultReleaseState(input({ resultRelease: 'immediate' }))).toBe('released');
    for (const mode of ['after_close', 'manual'] as const) {
      expect(resultReleaseState(input({ resultRelease: mode })), mode).toBe('pending');
      expect(resultReleaseState(input({ resultRelease: mode }, { resultsReleasedAt: null })), mode).toBe('pending');
      expect(resultReleaseState(input({ resultRelease: mode }, { resultsReleasedAt: 5 })), mode).toBe('released');
    }
    expect(resultReleaseState(input({ resultRelease: 'never' }, { resultsReleasedAt: 5 }))).toBe('never');
  });

  it('RES-05 withdrawn results read withdrawn in every mode that can release', () => {
    for (const mode of ['immediate', 'after_close', 'manual'] as const)
      expect(resultReleaseState(input({ resultRelease: mode }, { resultsReleasedAt: 5, resultsWithdrawn: true }))).toBe(
        'withdrawn',
      );
    expect(resultReleaseState(input({ resultRelease: 'never' }, { resultsWithdrawn: true }))).toBe('never');
  });
});

describe('resultsPublic', () => {
  it('RES-01 LB-04 released results are public, in a flexible window only from its end', () => {
    expect(resultsPublic(input({ resultRelease: 'immediate' }), before)).toBe(true);
    expect(resultsPublic(input({ resultRelease: 'immediate', timingMode: 'flexible' }), before)).toBe(false);
    expect(resultsPublic(input({ resultRelease: 'immediate', timingMode: 'flexible' }), after)).toBe(true);
    expect(resultsPublic(input({ resultRelease: 'manual' }), after)).toBe(false);
    expect(resultsPublic(input({ resultRelease: 'manual' }, { resultsReleasedAt: 5 }), before)).toBe(true);
    expect(resultsPublic(input({ resultRelease: 'immediate' }, { resultsWithdrawn: true }), after)).toBe(false);
    expect(resultsPublic(input({ resultRelease: 'never' }), after)).toBe(false);
  });
});

describe('manualReleaseRefusal', () => {
  it('RES-01 refuses a test set to never and allows the other modes', () => {
    expect(manualReleaseRefusal(input({ resultRelease: 'never' }), after)).toBe('RESULTS_NOT_RELEASABLE');
    for (const mode of ['immediate', 'after_close', 'manual'] as const)
      expect(manualReleaseRefusal(input({ resultRelease: mode, resultDetail: 'full' }), before), mode).toBeNull();
  });

  it('RES-01 SER-09 DATA-05 refuses a full review before a flexible window ends, and allows it from the end', () => {
    const full = input({ resultRelease: 'manual', resultDetail: 'full', timingMode: 'flexible' });
    expect(manualReleaseRefusal(full, before)).toBe('FULL_REVIEW_BEFORE_CLOSE');
    expect(manualReleaseRefusal(full, after)).toBeNull();
    expect(
      manualReleaseRefusal({ ...full, settings: { ...full.settings, resultDetail: 'sections' } }, before),
    ).toBeNull();
  });
});

describe('releaseResultsTask', () => {
  it('RES-01 is named for the org, test and window end and scheduled at the window end', () => {
    const task = releaseResultsTask({ orgId: 'org-a', testId: 't1', windowEnd: window.end });
    expect(task).toEqual({
      name: `release-results-org-a-t1-${window.end}`,
      path: '/tasks/release-results',
      payload: { orgId: 'org-a', testId: 't1' },
      scheduleTime: window.end,
    });
    expect(releaseResultsTask({ orgId: 'org-a', testId: 't1', windowEnd: window.end + 60_000 }).name).not.toBe(
      task.name,
    );
  });
});

describe('releaseTaskAction', () => {
  it('RES-01 REL-04 releases after_close at the window end once, and only recomputes otherwise', () => {
    expect(releaseTaskAction(input({}), before)).toBe('early');
    expect(releaseTaskAction(input({}), after)).toBe('release');
    expect(releaseTaskAction(input({}, { resultsReleasedAt: after }), after + 1), 'already released').toBe('recompute');
    expect(releaseTaskAction(input({}, { resultsWithdrawn: true }), after), 'stays withdrawn').toBe('recompute');
    for (const mode of ['immediate', 'manual', 'never'] as const)
      expect(releaseTaskAction(input({ resultRelease: mode }), after), mode).toBe('recompute');
    expect(releaseTaskAction(input({ window: null }), after), 'no window').toBe('early');
  });
});

describe('leaderboardRecomputeTask', () => {
  it('LB-03 queues a recompute due at once under the test board task prefix', () => {
    const payload = { orgId: 'org-a', testId: 't1', seriesId: 's1' };
    expect(leaderboardRecomputeTask(payload, 'release-42', 42)).toEqual({
      name: 'leaderboard-org-a-t1-release-42',
      path: '/tasks/leaderboard',
      payload,
      scheduleTime: 42,
    });
  });
});
