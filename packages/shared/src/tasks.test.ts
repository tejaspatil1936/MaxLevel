import { describe, expect, it } from 'vitest';
import { autoSubmitAction, autoSubmitTask, leaderboardTask } from './tasks';

describe('autoSubmitTask', () => {
  it('EX-03 EX-16 schedules the auto-submit 2 minutes after the deadline under a name for that attempt and deadline', () => {
    const task = autoSubmitTask('org-a', 'att-1', 1_793_595_600_000);
    expect(task).toEqual({
      name: 'auto-submit-att-1-1793595600000',
      path: '/tasks/auto-submit',
      payload: { orgId: 'org-a', attemptId: 'att-1', deadlineAt: 1_793_595_600_000 },
      scheduleTime: 1_793_595_720_000,
    });
    expect(autoSubmitTask('org-a', 'att-1', 1_793_595_660_000).name, 'a later deadline is a new task').not.toBe(
      task.name,
    );
  });
});

describe('autoSubmitAction', () => {
  const deadlineAt = 600_000;
  const due = deadlineAt + 120_000;
  it('EX-16 REL-04 finalizes an attempt in progress once the late sync grace has passed, and skips a finished one', () => {
    expect(autoSubmitAction({ status: 'in_progress', deadlineAt }, deadlineAt, due)).toBe('finalize');
    expect(autoSubmitAction({ status: 'in_progress', deadlineAt }, undefined, due + 1)).toBe('finalize');
    for (const status of ['submitted', 'auto_submitted', 'terminated', 'reset'])
      expect(autoSubmitAction({ status, deadlineAt }, deadlineAt, due), status).toBe('skip');
    expect(autoSubmitAction(null, deadlineAt, due)).toBe('skip');
  });

  it('EX-16 reschedules when the deadline moved later, and retries a run that came early for the same deadline', () => {
    const moved = { status: 'in_progress', deadlineAt: deadlineAt + 300_000 };
    expect(autoSubmitAction(moved, deadlineAt, due)).toBe('reschedule');
    expect(autoSubmitAction(moved, undefined, due)).toBe('reschedule');
    expect(autoSubmitAction({ status: 'in_progress', deadlineAt }, deadlineAt, due - 1)).toBe('retry');
  });
});

describe('leaderboardTask', () => {
  it('EX-17 LB-03 queues one recompute per test and 30-second slot, run when the slot ends', () => {
    const a = leaderboardTask('org-a', 't1', 's1', 60_000);
    expect(a).toEqual({
      name: 'leaderboard-org-a-t1-2',
      path: '/tasks/leaderboard',
      payload: { orgId: 'org-a', testId: 't1', seriesId: 's1' },
      scheduleTime: 90_000,
    });
    expect(leaderboardTask('org-a', 't1', 's1', 89_999).name, 'same slot, same task').toBe(a.name);
    expect(leaderboardTask('org-a', 't1', 's1', 90_000).name).not.toBe(a.name);
    expect(leaderboardTask('org-a', 't2', 's1', 60_000).name).not.toBe(a.name);
  });
});
