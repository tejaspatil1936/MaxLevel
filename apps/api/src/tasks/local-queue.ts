import type { Clock, PendingTask, TaskQueue, TaskRequest } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';

/** gRPC ALREADY_EXISTS: a task with this name is already queued. */
const ALREADY_EXISTS = 6;

/**
 * The `local` TaskQueue driver (docs/TEST_ENV.md, "Cloud Tasks"): tasks are stored in the Firestore emulator under
 * `_localTasks/{name}` with their schedule time, so the API and the worker share one queue. The name is the document
 * ID, so enqueueing the same task twice stores it once.
 */
export function localTaskQueue(db: Firestore, clock: Clock): TaskQueue & { pending(): Promise<PendingTask[]> } {
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

    /** Tasks not yet run, soonest first. */
    async pending(): Promise<PendingTask[]> {
      const snap = await col.where('status', '==', 'pending').get();
      return snap.docs
        .map((d) => ({ name: d.id, path: d.get('path') as string, scheduleTime: d.get('scheduleTime') as number }))
        .sort((a, b) => a.scheduleTime - b.scheduleTime || a.name.localeCompare(b.name));
    },
  };
}
export type LocalTaskQueue = ReturnType<typeof localTaskQueue>;
