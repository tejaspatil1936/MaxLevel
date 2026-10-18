import type { Clock } from '@mitaoe/shared';
import type { DocumentReference, Firestore } from 'firebase-admin/firestore';

/** What the dispatcher logs: a pino or Fastify logger. */
export interface DispatchLog {
  warn(obj: object, msg: string): void;
}

export interface TaskDispatcher {
  /** Runs every pending task due on the clock, and waits for those already running; returns their names. */
  runDue(): Promise<string[]>;
  /** Checks for due tasks every `intervalMs` (docs/TEST_ENV.md: 250 ms). */
  start(log?: DispatchLog, intervalMs?: number): void;
  /** Stops checking and waits for the tasks in flight. */
  stop(): Promise<void>;
}

interface StoredTask {
  name: string;
  path: string;
  payload: unknown;
  attempts?: number;
}

/** A failed run is tried again after 1, 2, 4 … seconds, at most a minute apart, like a Cloud Tasks queue's backoff. */
const retryAfterMs = (attempts: number) => Math.min(1000 * 2 ** (attempts - 1), 60_000);

/**
 * The local queue's dispatcher (docs/TEST_ENV.md, "Cloud Tasks"): the API process posts each `_localTasks` task whose
 * schedule time has passed on the Clock to `WORKER_URL` + its path, as Cloud Tasks would push it. A task is claimed in
 * a transaction (pending to running), so it runs once even when a check and `run-due` race; a 2xx marks it done,
 * anything else puts it back as pending with a later schedule time (handlers are idempotent, REL-04).
 */
export function localTaskDispatcher(db: Firestore, clock: Clock, opts: { workerUrl: string }): TaskDispatcher {
  const col = db.collection('_localTasks');
  const inFlight = new Map<string, Promise<void>>();
  let log: DispatchLog | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking = false;

  async function claim(ref: DocumentReference): Promise<StoredTask | null> {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.get('status') !== 'pending' || (snap.get('scheduleTime') as number) > clock.now()) return null;
      tx.update(ref, { status: 'running', startedAt: clock.now() });
      return snap.data() as StoredTask;
    });
  }

  async function post(ref: DocumentReference, task: StoredTask): Promise<void> {
    const attempts = (task.attempts ?? 0) + 1;
    let error: string | null = null;
    try {
      const res = await fetch(`${opts.workerUrl}${task.path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-cloudtasks-taskname': task.name,
          'x-cloudtasks-taskretrycount': String(attempts - 1),
        },
        body: JSON.stringify(task.payload ?? {}),
      });
      if (!res.ok) error = `HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`;
    } catch (err) {
      error = String(err);
    }
    const now = clock.now();
    if (error === null) return void (await ref.update({ status: 'done', doneAt: now, attempts }));
    log?.warn({ task: task.name, attempts, error }, 'task failed; retrying later');
    await ref.update({ status: 'pending', attempts, lastError: error, scheduleTime: now + retryAfterMs(attempts) });
  }

  /** Claims and starts every due task not already running here; resolves with the names it started. */
  async function startDue(): Promise<string[]> {
    const due = await col.where('status', '==', 'pending').where('scheduleTime', '<=', clock.now()).get();
    const started: string[] = [];
    for (const doc of due.docs) {
      if (inFlight.has(doc.id)) continue;
      const task = await claim(doc.ref);
      if (!task) continue;
      const run = post(doc.ref, task)
        .catch((err: unknown) => log?.warn({ task: doc.id, err: String(err) }, 'task bookkeeping failed'))
        .finally(() => inFlight.delete(doc.id));
      inFlight.set(doc.id, run);
      started.push(doc.id);
    }
    return started;
  }

  return {
    async runDue() {
      const running = [...inFlight.keys()];
      const started = await startDue();
      const names = [...new Set([...running, ...started])];
      await Promise.all(names.map((n) => inFlight.get(n)));
      return names;
    },

    start(logger, intervalMs = 250) {
      log = logger;
      if (timer) return;
      // A task left running by a process that stopped mid-run is run again (its handler is idempotent).
      checking = true;
      void col
        .where('status', '==', 'running')
        .get()
        .then((snap) => Promise.all(snap.docs.map((d) => d.ref.update({ status: 'pending' }))))
        .catch((err: unknown) => log?.warn({ err: String(err) }, 'requeueing interrupted tasks failed'))
        .finally(() => (checking = false));
      timer = setInterval(() => {
        if (checking) return;
        checking = true;
        startDue()
          .catch((err: unknown) => log?.warn({ err: String(err) }, 'checking for due tasks failed'))
          .finally(() => (checking = false));
      }, intervalMs);
      timer.unref();
    },

    async stop() {
      clearInterval(timer);
      timer = undefined;
      await Promise.all(inFlight.values());
    },
  };
}
