import { prewarmTask, releaseResultsTask, type Settings, type TaskQueue } from '@mitaoe/shared';

/**
 * What publishing a test queues (RES-01, PERF-06), shared by Publish test and the `exam-test` scenario: the release
 * task at the window end (attempt starts queue it again, idempotently by name) and the pre-warm 30 minutes before the
 * slot. A moved date sends the test back to review, so the next publish queues tasks for the new window.
 */
export async function queuePublishTasks(
  queue: TaskQueue,
  input: { orgId: string; testId: string; settings: Pick<Settings, 'window'>; now: number },
): Promise<void> {
  const { orgId, testId, settings, now } = input;
  if (!settings.window) return;
  await Promise.all([
    queue.enqueue(releaseResultsTask({ orgId, testId, windowEnd: settings.window.end })),
    queue.enqueue(prewarmTask({ orgId, testId, windowStart: settings.window.start }, now)),
  ]);
}
