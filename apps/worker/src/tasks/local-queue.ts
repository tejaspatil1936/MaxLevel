import type { Clock, TaskQueue, TaskRequest } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';

/** gRPC ALREADY_EXISTS: a task with this name is already queued. */
const ALREADY_EXISTS = 6;

/**
 * The worker's side of the `local` TaskQueue driver (docs/TEST_ENV.md, "Cloud Tasks"): the same `_localTasks/{name}`
 * records as the API's driver (apps/api/src/tasks/local-queue.ts), which the API process dispatches. The name is the
 * document ID, so enqueueing the same task twice stores it once.
 */
export function localTaskQueue(db: Firestore, clock: Clock): TaskQueue {
  const col = db.collection('_localTasks');
  return {
    async enqueue(task: TaskRequest): Promise<void> {
      const now = clock.now();
      try {
        await col.doc(task.name).create({
          name: task.name,
          path: task.path,
          payload: task.payload,
          scheduleTime: task.scheduleTime ?? now,
          status: 'pending',
          createdAt: now,
        });
      } catch (err) {
        if ((err as { code?: number }).code !== ALREADY_EXISTS) throw err;
      }
    },
  };
}
