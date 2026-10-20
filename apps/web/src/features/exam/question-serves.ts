import { retryDelayMs } from '@mitaoe/shared';

// Per-question timers (Q-11, Q-12): each timed question is reported once to `POST …/navigate` when the exam shows it,
// so the server records its first serve time. A failed report is retried (1, 2, 4, 8, then every 15 seconds) until
// the server answers; the answer sync waits for reports in flight, so an answer never reaches the server before the
// serve of its question.

export interface ServeDeps {
  send: (questionId: string) => Promise<{ servedAt: number }>;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule: (fn: () => void, ms: number) => () => void;
  /** The server's first serve time of a question. */
  onServed: (questionId: string, servedAt: number) => void;
  /** True for a failure a retry can't fix (for example, the attempt is finished); it is not retried. */
  final?: (error: unknown) => boolean;
}

export interface ServeTracker {
  /** Reports a question as shown; a question already reported (or being reported) is left alone. */
  serve(questionId: string): void;
  /** Resolves once every report now in flight has had its answer, whatever it was. */
  settled(): Promise<void>;
  dispose(): void;
}

export function createServeTracker(deps: ServeDeps): ServeTracker {
  const known = new Set<string>();
  const inFlight = new Set<Promise<unknown>>();
  const retries = new Set<() => void>();
  let disposed = false;

  const attempt = (questionId: string, failures: number) => {
    if (disposed) return;
    const request = deps.send(questionId).then(
      ({ servedAt }) => {
        if (!disposed) deps.onServed(questionId, servedAt);
      },
      (e: unknown) => {
        if (disposed || deps.final?.(e)) return;
        const cancel = deps.schedule(
          () => {
            retries.delete(cancel);
            attempt(questionId, failures + 1);
          },
          retryDelayMs(failures + 1),
        );
        retries.add(cancel);
      },
    );
    inFlight.add(request);
    void request.finally(() => inFlight.delete(request));
  };

  return {
    serve(questionId) {
      if (known.has(questionId)) return;
      known.add(questionId);
      attempt(questionId, 0);
    },
    async settled() {
      await Promise.allSettled([...inFlight]);
    },
    dispose() {
      disposed = true;
      for (const cancel of retries) cancel();
      retries.clear();
    },
  };
}
