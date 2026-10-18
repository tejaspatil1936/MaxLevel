import { retryDelayMs, type AnswerBatch, type AnswerBatchResult } from '@mitaoe/shared';

// The answer sync queue (EX-10 to EX-12): every change gets the question's next sequence number and an offset-corrected
// timestamp, and only the newest change of each question waits. Batches go to `PUT …/answers` one at a time; a failed
// batch is retried after 1, 2, 4 and 8 seconds, then every 15, measured from each failure, with no jitter. The queue is
// in memory here; IndexedDB persistence (F-3.07) plugs in around `record` and the pending set.

export type SyncStatus = { kind: 'saved' } | { kind: 'saving' } | { kind: 'offline'; waiting: number };

export type PendingAnswer = AnswerBatch['answers'][number] & { markedForReview: boolean };

export interface AnswerSyncDeps {
  send: (batch: AnswerBatch) => Promise<AnswerBatchResult>;
  /** The server's time (device time plus the measured offset), for `clientTs`. */
  now: () => number;
  clockOffsetMs: () => number;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule: (fn: () => void, ms: number) => () => void;
  onStatus: (status: SyncStatus) => void;
  /** A failure that a retry can't fix (a refused batch): its answers are dropped instead of retried. */
  isPermanent?: (error: unknown) => boolean;
}

export interface AnswerSync {
  record(questionId: string, optionId: string | null, markedForReview: boolean): void;
  /** Answers not yet accepted by the server. */
  waiting(): number;
  dispose(): void;
}

const MAX_BATCH = 200;

/** `storedSeq` holds each question's saved sequence number from the attempt payload, so new ones are higher (EX-11). */
export function createAnswerSync(storedSeq: Readonly<Record<string, number>>, deps: AnswerSyncDeps): AnswerSync {
  const seqs = new Map(Object.entries(storedSeq));
  const pending = new Map<string, PendingAnswer>();
  let inFlight = false;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  let disposed = false;

  const emit = () => {
    if (disposed) return;
    if (inFlight) deps.onStatus({ kind: 'saving' });
    else if (pending.size === 0) deps.onStatus({ kind: 'saved' });
    else if (failures > 0) deps.onStatus({ kind: 'offline', waiting: pending.size });
  };

  /** Drops the sent answers that no newer change has replaced. */
  const settle = (batch: readonly PendingAnswer[]) => {
    for (const a of batch) if (pending.get(a.questionId)?.seq === a.seq) pending.delete(a.questionId);
  };

  async function pump(): Promise<void> {
    if (inFlight || disposed || pending.size === 0) return emit();
    inFlight = true;
    cancelRetry = null;
    emit();
    const batch = [...pending.values()].slice(0, MAX_BATCH);
    try {
      await deps.send({ answers: batch, backlog: pending.size, clockOffsetMs: Math.round(deps.clockOffsetMs()) });
      settle(batch);
      failures = 0;
    } catch (error) {
      if (deps.isPermanent?.(error)) {
        settle(batch);
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

  return {
    record(questionId, optionId, markedForReview) {
      const seq = (seqs.get(questionId) ?? 0) + 1;
      seqs.set(questionId, seq);
      pending.set(questionId, { questionId, optionId, seq, clientTs: Math.round(deps.now()), markedForReview });
      // While a retry waits, the change joins the next attempt instead of jumping the backoff.
      if (failures === 0) void pump();
      else emit();
    },
    waiting: () => pending.size,
    dispose() {
      disposed = true;
      cancelRetry?.();
    },
  };
}
