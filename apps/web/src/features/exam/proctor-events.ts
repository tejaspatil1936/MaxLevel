import {
  type AttemptEventDetails,
  countsAsNewStrike,
  isStrikeEvent,
  retryDelayMs,
  type AttemptEventReport,
  type AttemptEventResult,
  type ProctorEventType,
  type ServerStrike,
  type Settings,
} from '@mitaoe/shared';

// Proctoring reports from the exam screen (PR-08, PR-09, spec 11.2). Lockdown (F-3.11), the laptop camera (F-3.12) and
// the phone presence (F-3.13) call `report`; every event goes to `POST …/events`, which logs it and decides the count.
// A strike shows its warning at once, before the API answers, numbered with the next count; the server's count
// replaces it when the response arrives. Strikes within 3 seconds of the one that opened a warning are one incident
// (PR-07): they are still reported, and the warning keeps the first event's reason. Failed reports are retried with
// the answer sync's backoff, keeping their client time, until the API answers. A strike the server decided on its own
// (a phone outage, PR-16) arrives through `serverStrike` and warns the same way.

/** An event type the browser may report. */
export type ClientEventType = AttemptEventReport['type'];

export interface StrikeWarning {
  /** The event that opened the warning; its reason is shown. */
  type: ProctorEventType;
  /** The strike number: the next count until the server answers, then the server's count. */
  count: number;
}

export interface ProctorDeps {
  send: (report: AttemptEventReport) => Promise<AttemptEventResult>;
  /** Server time (the clock offset applied). */
  now: () => number;
  /** Runs `fn` after `ms`; returns a function that cancels it. */
  schedule: (fn: () => void, ms: number) => () => void;
  devtoolsPolicy: Settings['devtoolsPolicy'];
  /** The attempt's strike count when the exam opened. */
  strikesCount: number;
  onCount: (count: number) => void;
  onWarning: (warning: StrikeWarning | null) => void;
  /** The attempt ended: terminated at the maximum, or finished some other way. */
  onFinished: () => void;
  /** True for a failure a retry can't fix (for example, the attempt is finished); it is not retried. */
  final?: (error: unknown) => boolean;
}

export interface ProctorReporter {
  report(type: ClientEventType, details?: AttemptEventDetails): void;
  /**
   * A strike the server decided (the attempt's proctor record). Each is shown once; one counted before the exam opened
   * here (its count is not above the opening count) is not shown again.
   */
  serverStrike(strike: ServerStrike): void;
  /** The student acknowledged the warning. */
  acknowledge(): void;
  dispose(): void;
}

export function createProctorReporter(deps: ProctorDeps): ProctorReporter {
  let count = deps.strikesCount;
  let lastIncidentAt: number | undefined;
  let warning: (StrikeWarning & { report: AttemptEventReport }) | null = null;
  let disposed = false;
  let finished = false;
  const serverStrikes = new Set<string>();
  const retries = new Set<() => void>();

  const show = (next: typeof warning) => {
    warning = next;
    deps.onWarning(next ? { type: next.type, count: next.count } : null);
  };

  const answered = (report: AttemptEventReport, result: AttemptEventResult) => {
    // Responses may arrive out of order; the count only goes up.
    if (result.strikesCount > count) {
      count = result.strikesCount;
      deps.onCount(count);
    }
    if (warning?.report === report && warning.count !== result.strikesCount)
      show({ ...warning, count: result.strikesCount });
    if (result.status !== 'in_progress') finish();
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    deps.onFinished();
  };

  const send = (report: AttemptEventReport, failures: number) => {
    if (disposed || finished) return;
    deps.send(report).then(
      (result) => {
        if (!disposed) answered(report, result);
      },
      (e: unknown) => {
        if (disposed || deps.final?.(e)) return;
        const cancel = deps.schedule(
          () => {
            retries.delete(cancel);
            send(report, failures + 1);
          },
          retryDelayMs(failures + 1),
        );
        retries.add(cancel);
      },
    );
  };

  return {
    report(type, details = {}) {
      if (disposed || finished) return;
      // `clientTs` is whole milliseconds (the schema takes an int); the offset-corrected clock may be fractional.
      const now = Math.round(deps.now());
      const report: AttemptEventReport = { type, clientTs: now, details };
      if (isStrikeEvent(type, deps.devtoolsPolicy) && countsAsNewStrike(lastIncidentAt, now)) {
        lastIncidentAt = now;
        show({ type, count: count + 1, report });
      }
      send(report, 0);
    },
    serverStrike(strike) {
      if (disposed || finished || serverStrikes.has(strike.eventId)) return;
      serverStrikes.add(strike.eventId);
      if (strike.strikesCount <= deps.strikesCount) return;
      if (strike.strikesCount > count) {
        count = strike.strikesCount;
        deps.onCount(count);
      }
      lastIncidentAt = Math.round(deps.now());
      warning = null;
      deps.onWarning({ type: strike.type, count: strike.strikesCount });
      if (strike.status !== 'in_progress') finish();
    },
    acknowledge() {
      // A server strike's warning has no report behind it, so it is cleared here too.
      show(null);
    },
    dispose() {
      disposed = true;
      for (const cancel of retries) cancel();
      retries.clear();
    },
  };
}
