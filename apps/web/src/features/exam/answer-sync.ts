import { retryDelayMs, type AnswerBatch, type AnswerBatchResult } from '@mitaoe/shared';

// The answer sync queue (EX-10 to EX-12): every change gets the question's next sequence number and an offset-corrected
// timestamp, is handed to the device store (IndexedDB) at once, and only the newest change of each question waits.
// Batches go to `PUT …/answers` one at a time; a failed batch is retried after 1, 2, 4 and 8 seconds, then every 15,
// measured from each failure, with no jitter. Coming back online sends at once. An answer the server refuses (a
// rejection in the result, or a refused batch) is never dropped silently: it is reported through `onRejected` until a
// later change of that question is saved.

export type SyncStatus = { kind: 'saved' } | { kind: 'saving' } | { kind: 'offline'; waiting: number };

export type PendingAnswer = AnswerBatch['answers'][number] & { markedForReview: boolean };

/** Where an answer stands on the device: waiting to sync, accepted by the server, or refused by it. */
export type LocalAnswerState = 'waiting' | 'saved' | 'rejected';

export interface Rejection {
  questionId: string;
  code: string;
}

export interface AnswerSyncDeps {
  send: (batch: AnswerBatch) => Promise<AnswerBatchResult>;
  /** The server's time (device time plus the measured offset), for `clientTs`. */
  now: () => number;
  clockOffsetMs: () => number;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule: (fn: () => void, ms: number) => () => void;
  onStatus: (status: SyncStatus) => void;
  /** The code of a failure that a retry can't fix (a refused batch), or null to retry it. */
  refusal?: (error: unknown) => string | null;
  /** Keeps each answer on the device (IndexedDB); called in order, newest state last. */
  store?: (answer: PendingAnswer, state: LocalAnswerState) => void;
  /** Every answer the server refused that no later saved change has replaced, in question order of refusal. */
  onRejected?: (rejections: Rejection[]) => void;
  /** Whether the browser says it has a network (`navigator.onLine`); assumed online when left out. */
  online?: boolean;
}

export interface AnswerSync {
  record(questionId: string, optionId: string | null, markedForReview: boolean): void;
  /** The browser's network came or went (`online` and `offline` events). */
  setOnline(online: boolean): void;
  /** Answers not yet accepted by the server. */
  waiting(): number;
  dispose(): void;
}

const MAX_BATCH = 200;

/**
 * `storedSeq` holds each question's saved sequence number, so new ones are higher (EX-11). `waiting` holds answers
 * kept on the device that the server has not accepted yet (after a reload); they are sent first.
 */
export function createAnswerSync(
  storedSeq: Readonly<Record<string, number>>,
  deps: AnswerSyncDeps,
  waiting: readonly PendingAnswer[] = [],
): AnswerSync {
  const seqs = new Map(Object.entries(storedSeq));
  const pending = new Map<string, PendingAnswer>();
  for (const a of waiting) {
    pending.set(a.questionId, a);
    seqs.set(a.questionId, Math.max(seqs.get(a.questionId) ?? 0, a.seq));
  }
  const rejected = new Map<string, string>();
  let online = deps.online ?? true;
  let inFlight = false;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    if (inFlight) deps.onStatus({ kind: 'saving' });
    else if (pending.size === 0) deps.onStatus(online ? { kind: 'saved' } : { kind: 'offline', waiting: 0 });
    else if (failures > 0 || !online) deps.onStatus({ kind: 'offline', waiting: pending.size });
  };

  const report = () => {
    if (!disposed) deps.onRejected?.([...rejected].map(([questionId, code]) => ({ questionId, code })));
  };

  /** Settles the sent answers that no newer change has replaced, as saved or refused. */
  const settle = (batch: readonly PendingAnswer[], refusedCodes: ReadonlyMap<string, string>) => {
    let changed = false;
    for (const a of batch) {
      if (pending.get(a.questionId)?.seq !== a.seq) continue;
      pending.delete(a.questionId);
      const code = refusedCodes.get(a.questionId);
      deps.store?.(a, code ? 'rejected' : 'saved');
      if (code) {
        rejected.set(a.questionId, code);
        changed = true;
      } else if (rejected.delete(a.questionId)) changed = true;
    }
    if (changed) report();
  };

  async function pump(): Promise<void> {
    if (inFlight || disposed || pending.size === 0) return emit();
    inFlight = true;
    cancelRetry = null;
    emit();
    const batch = [...pending.values()].slice(0, MAX_BATCH);
    try {
      const result = await deps.send({
        answers: batch,
        backlog: pending.size,
        clockOffsetMs: Math.round(deps.clockOffsetMs()),
      });
      settle(batch, new Map(result.rejected.map((r) => [r.questionId, r.code])));
      failures = 0;
    } catch (error) {
      const code = deps.refusal?.(error) ?? null;
      if (code) {
        settle(batch, new Map(batch.map((a) => [a.questionId, code])));
        failures = 0;
      } else failures++;
    } finally {
      inFlight = false;
    }
    if (disposed) return;
    if (failures === 0) return pump();
    emit();
    cancelRetry = deps.schedule(() => void pump(), retryDelayMs(failures));
  }

  if (pending.size > 0) void pump();

  return {
    record(questionId, optionId, markedForReview) {
      const seq = (seqs.get(questionId) ?? 0) + 1;
      seqs.set(questionId, seq);
      const answer = { questionId, optionId, seq, clientTs: Math.round(deps.now()), markedForReview };
      pending.set(questionId, answer);
      deps.store?.(answer, 'waiting');
      // While a retry waits, the change joins the next attempt instead of jumping the backoff.
      if (failures === 0) void pump();
      else emit();
    },
    setOnline(next) {
      online = next;
      if (online && failures > 0 && !inFlight && pending.size > 0) {
        cancelRetry?.();
        void pump();
      } else emit();
    },
    waiting: () => pending.size,
    dispose() {
      disposed = true;
      cancelRetry?.();
    },
  };
}
