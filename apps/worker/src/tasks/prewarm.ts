import { prewarmAction, prewarmMinInstances, type Clock } from '@mitaoe/shared';
import { z } from 'zod';
import type { WorkerData } from '../data';
import type { InstanceScaler } from '../scaler';

export const prewarmPayloadSchema = z.object({
  orgId: z.string().min(1).max(128),
  testId: z.string().min(1).max(128),
  windowStart: z.number().int(),
});
export type PrewarmRun = z.infer<typeof prewarmPayloadSchema>;

/** What a run did: nothing (`skipped` for a moved or cancelled slot, `done` for one already raised) or `raised`. */
export type PrewarmOutcome = 'skipped' | 'done' | 'raised';

/**
 * /tasks/prewarm (PERF-06, REL-04): for a published test still on this window start, raises the API minimum instances
 * by its eligible students until the window end, then records the slot, so a retry or a second run of the same task
 * calls the scaler no more. A test moved to another slot, unpublished or past its window end is left alone. Every run
 * answers 200.
 */
export function prewarmHandler(deps: { data: WorkerData; clock: Clock; scaler: InstanceScaler }) {
  const { data, clock, scaler } = deps;
  return async (run: PrewarmRun): Promise<PrewarmOutcome> => {
    const target = await data.getPrewarmTarget(run.orgId, run.testId);
    const action = prewarmAction(target, run.windowStart, clock.now());
    if (action !== 'raise' || !target?.window) return action === 'done' ? 'done' : 'skipped';
    const minInstances = prewarmMinInstances(await data.countEligibleStudents(run.orgId, run.testId));
    await scaler.raiseMinInstances({
      minInstances,
      until: target.window.end,
      reason: `prewarm-${run.orgId}-${run.testId}-${run.windowStart}`,
    });
    await data.markPrewarmed(run.orgId, run.testId, run.windowStart, clock.now());
    return 'raised';
  };
}
