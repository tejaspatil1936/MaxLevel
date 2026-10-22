import {
  gradeAttempt,
  leaderboardTask,
  phoneCheckVerdict,
  presencePath,
  strikeVerdict,
  type Clock,
  type PhoneCheckPayload,
  type PhoneCheckVerdict,
  type PhonePresence,
  type TaskQueue,
} from '@mitaoe/shared';
import type { WorkerData } from '../data';
import type { LiveMirror, PresenceReader } from '../live';

export { phoneCheckPayloadSchema } from '@mitaoe/shared';

/** What a run did: the verdict when no strike was due, else what recording the strike did. */
export type PhoneCheckOutcome =
  Exclude<PhoneCheckVerdict, 'strike'> | 'skipped' | 'counted' | 'merged' | 'terminated' | 'repeat';

type Logger = { warn(obj: object, msg: string): void };

/**
 * /tasks/phone-check (PR-16, REL-04, REL-05): the server, not the laptop, decides a phone outage strike. Queued by
 * the API when the laptop reports a phone paused for over 15 seconds, it runs when the outage reaches 60 seconds and
 * reads the phone and laptop presence itself. Shared `phoneCheckVerdict` decides; a strike is logged and counted with
 * the API's rules (`strikeVerdict`) under an event ID named by the outage, so a second run counts nothing. The strike
 * that reaches the maximum ends the attempt as `terminated` and grades it, as the API does (PR-10). The laptop learns of
 * the strike from the attempt's proctor record, and admins from the live record (OPS-02).
 */
export function phoneCheckHandler(deps: {
  data: WorkerData;
  clock: Clock;
  queue: TaskQueue;
  live: LiveMirror;
  presence: PresenceReader;
  log?: Logger;
}) {
  const { data, clock, queue, live, presence, log } = deps;
  /** Realtime Database writes are fire and forget: a failure is logged, never retried (REL-05). */
  const mirror = (write: Promise<void>, attemptId: string) =>
    void write.catch((err: unknown) => log?.warn({ err, attemptId }, 'realtime database write failed'));

  return async (run: PhoneCheckPayload): Promise<PhoneCheckOutcome> => {
    const attempt = await data.getAttempt(run.orgId, run.attemptId);
    if (!attempt) return 'skipped';
    if (attempt.status !== 'in_progress') return 'finished';
    // The paths come from the stored attempt, never the payload. A read that fails throws: the queue retries.
    const [phone, laptop] = await Promise.all([
      presence.read(presencePath(run.orgId, attempt.testId, attempt.id, 'phone')),
      presence.read(presencePath(run.orgId, attempt.testId, attempt.id, 'laptop')),
    ]);
    const verdict = phoneCheckVerdict({
      attemptStatus: attempt.status,
      laptop: (laptop as { online?: unknown } | null) ?? null,
      phone: (phone as Partial<PhonePresence> | null) ?? null,
      outage: run,
    });
    if (verdict !== 'strike') return verdict;
    const test = await data.getGradedTest(run.orgId, attempt.testId);
    if (!test) return 'skipped';
    const { devtoolsPolicy, maxStrikes } = test.resolved;
    const now = clock.now();
    const id = `phone-${run.stateSince ?? 'none'}-${run.lastSeen ?? 'none'}`;
    const details = { source: 'server', stateSince: run.stateSince, lastSeen: run.lastSeen };
    const done = await data.recordServerStrike(
      run.orgId,
      attempt.id,
      { id, type: 'phone_disconnected', details, serverTs: now },
      (stored) =>
        strikeVerdict({
          type: 'phone_disconnected',
          devtoolsPolicy,
          maxStrikes,
          strikesCount: stored.strikesCount,
          lastStrikeAt: stored.lastStrikeAt,
          now,
        }),
    );
    if (!done) return 'skipped';
    if (done === 'ATTEMPT_FINISHED') return 'finished';
    if (done.verdict.counted) mirror(live.strikes(run.orgId, done.attempt, now), attempt.id);

    // The strike that reaches the maximum ends the attempt; a run again finishes one a first run left at the maximum.
    let status: string = done.attempt.status;
    if (done.attempt.strikesCount >= maxStrikes && done.attempt.status === 'in_progress') {
      const keys = await data.answerKeys(run.orgId, test.id, attempt.draw.questionIds);
      const finished = await data.finalizeAttempt(run.orgId, attempt.id, (stored, answers) => ({
        status: 'terminated',
        submittedAt: now,
        terminationReason: 'max_strikes',
        result: gradeAttempt({
          attempt: stored,
          questions: keys,
          sections: test.sections,
          settings: test.resolved,
          answers,
          submittedAt: now,
        }),
      }));
      if (finished) status = finished.attempt.status;
      if (finished?.finalized) {
        mirror(live.finished(run.orgId, finished.attempt, now), attempt.id);
        await queue.enqueue(leaderboardTask(run.orgId, test.id, test.seriesId, now));
      }
    }

    // PR-09: the laptop shows the warning; a run again writes the same notice, so a lost write is made good.
    if (done.strikeNumber !== undefined)
      mirror(
        live.serverStrike(run.orgId, attempt.id, {
          eventId: id,
          type: 'phone_disconnected',
          strikesCount: done.strikeNumber,
          status,
        }),
        attempt.id,
      );
    if (done.repeat) return 'repeat';
    if (status === 'terminated') return 'terminated';
    return done.verdict.counted ? 'counted' : 'merged';
  };
}
