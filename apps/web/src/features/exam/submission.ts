import { retryDelayMs } from '@mitaoe/shared';

// Submitting (EX-15, EX-16): every waiting answer is synced first, then `POST …/submit` goes, with one Idempotency-Key
// for every try. A try that can't reach the API (or that a retry can fix) is tried again after 1, 2, 4 and 8 seconds,
// then every 15, and at once when the connection returns; the screen says the test will be submitted then.

/** `saving`: waiting for the answers to sync; `offline`: the submit couldn't reach the API and will be retried. */
export type SubmitPhase = 'idle' | 'saving' | 'sending' | 'offline' | 'failed' | 'done';
export type SubmitReason = 'time_up' | undefined;

export interface SubmissionDeps {
  /** Resolves once no answer waits or is in flight (AnswerSync.flush). */
  flush: () => Promise<void>;
  send: (reason: SubmitReason) => Promise<unknown>;
  /** True when a later try may succeed: no answer from the API, a 5xx, 408 or 429. */
  retryable: (error: unknown) => boolean;
  /** True when the API says the attempt is already finished (409 ATTEMPT_FINISHED): nothing is left to submit. */
  finished: (error: unknown) => boolean;
  /** The stored deadline when the API refused a time-up as early (409 DEADLINE_NOT_REACHED, OPS-06), else null. */
  notYet: (error: unknown) => number | null;
  /** The exam goes on to the deadline the API holds (extra time this device missed). */
  onDeadline: (deadlineAt: number) => void;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule: (fn: () => void, ms: number) => () => void;
  onPhase: (phase: SubmitPhase) => void;
  onDone: () => void;
}

export interface Submission {
  /** Starts submitting, unless a submission is already under way; `time_up` when the deadline passed (EX-16). */
  submit(reason?: SubmitReason): Promise<void>;
  /** The connection came back: an offline submission tries again now. */
  retryNow(): void;
  /** The student closed the summary: stops a submission that is waiting (one already sent goes on). */
  cancel(): void;
  dispose(): void;
}

export function createSubmission(deps: SubmissionDeps): Submission {
  let phase: SubmitPhase = 'idle';
  let reason: SubmitReason;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  let disposed = false;
  /** Bumped by cancel, so a flush that ends after it sends nothing. */
  let generation = 0;

  const set = (next: SubmitPhase) => {
    phase = next;
    if (!disposed) deps.onPhase(next);
  };
  const finish = () => {
    set('done');
    if (!disposed) deps.onDone();
  };

  async function send(): Promise<void> {
    cancelRetry = null;
    set('sending');
    try {
      await deps.send(reason);
      finish();
    } catch (error) {
      if (deps.finished(error)) return finish();
      if (disposed) return;
      const later = reason === 'time_up' ? deps.notYet(error) : null;
      if (later !== null) {
        set('idle');
        return deps.onDeadline(later);
      }
      if (!deps.retryable(error)) return set('failed');
      failures++;
      set('offline');
      cancelRetry = deps.schedule(() => void send(), retryDelayMs(failures));
    }
  }

  return {
    async submit(why) {
      if (phase !== 'idle' && phase !== 'failed') return;
      reason = why;
      failures = 0;
      const run = ++generation;
      set('saving');
      await deps.flush();
      if (disposed || run !== generation) return;
      await send();
    },
    retryNow() {
      if (phase !== 'offline') return;
      cancelRetry?.();
      void send();
    },
    cancel() {
      if (phase !== 'saving' && phase !== 'offline' && phase !== 'failed') return;
      cancelRetry?.();
      cancelRetry = null;
      generation++;
      set('idle');
    },
    dispose() {
      disposed = true;
      cancelRetry?.();
    },
  };
}
