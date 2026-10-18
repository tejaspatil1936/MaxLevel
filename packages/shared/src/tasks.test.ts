import { describe, expect, it } from 'vitest';
import { autoSubmitTask } from './tasks';

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
