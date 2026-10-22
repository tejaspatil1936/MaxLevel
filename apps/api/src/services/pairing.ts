import {
  isFinishedAttempt,
  PAIRING_TOKEN_TTL_MS,
  pairingTokenVerdict,
  proctorPath,
  type Clock,
  type PairingRedeemResult,
  type PairingReservation,
  type PairingToken,
} from '@mitaoe/shared';
import { createHash, randomBytes } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';
import type { Database } from 'firebase-admin/database';
import type { Data } from '../data';
import { AppError, notFound } from '../errors';
import { ORG_ID } from '../plugins/auth';
import { admitStudent, assertStartWindow } from './attempts';
import { liveMirror } from './live-mirror';
import { withinLimit, type WarnLogger } from './rtdb-writes';

export interface PairingDeps {
  data: Data;
  clock: Clock;
  rtdb: Database;
  auth: Auth;
  /** The web app's origin; pairing links open `<origin>/pair/?token=<token>`. */
  webOrigin: string;
  /** Where a failed or late `attemptOwners/…` write is logged (REL-05). */
  log: WarnLogger;
}

const finished = () => new AppError(409, 'ATTEMPT_FINISHED', "You've already finished this test.");
const invalid = () => new AppError(404, 'PAIRING_TOKEN_INVALID', "This pairing link isn't valid.");
/** Only a hash of the secret is stored, so a leaked record can't be redeemed. */
const keyOf = (secret: string) => createHash('sha256').update(secret).digest('hex');

/**
 * Phone pairing (spec 7.9, PR-13, PR-14). A token is `<orgId>.<secret>`: the organization lets the phone, which is not
 * signed in, find the token under its own organization (ORG-03), and the secret (32 random bytes) is what proves it.
 */
export function pairingService(deps: PairingDeps) {
  const { data, clock, rtdb, auth, webOrigin, log } = deps;
  const live = liveMirror(rtdb, log);

  async function issue(
    orgId: string,
    ref: { testId: string; attemptId: string; studentId: string; uid: string },
  ): Promise<PairingToken> {
    const secret = randomBytes(32).toString('base64url');
    const issuedAt = clock.now();
    const expiresAt = issuedAt + PAIRING_TOKEN_TTL_MS;
    await data.pairing.createToken(orgId, keyOf(secret), { ...ref, issuedAt, expiresAt });
    const token = `${orgId}.${secret}`;
    return { token, url: `${webOrigin}/pair/?token=${encodeURIComponent(token)}`, expiresAt };
  }

  return {
    /**
     * POST /v1/tests/{testId}/pairing-token: pairing on the rules screen, before Start. Checked like a start (404,
     * 403 NOT_ELIGIBLE, the start window), it reserves the attempt ID Start will use (or returns the started attempt's)
     * and writes the attempt's owner for the Realtime Database rules and the `pairing` live record (waiting at most OWNER_WRITE_LIMIT_MS, REL-05); a
     * refusal stores nothing.
     */
    async reserve(orgId: string, who: { uid: string; studentId: string }, testId: string): Promise<PairingReservation> {
      const test = await data.tests.getTest(orgId, testId);
      if (!test || test.status !== 'scheduled' || !test.resolved) throw notFound('Test');
      const [series, student] = await Promise.all([
        data.series.getSeries(orgId, test.seriesId),
        data.students.getStudent(orgId, who.studentId),
      ]);
      const { settings, student: admitted } = admitStudent(test, series, student);
      const now = clock.now();
      const { attemptId, status } = await data.attempts.reserveAttempt(
        orgId,
        { testId, studentId: who.studentId },
        (start) => assertStartWindow(settings, now, start.afterReset),
      );
      if (status && isFinishedAttempt(status)) throw finished();
      // OPS-02: a reservation without an attempt shows as `pairing` in the live view.
      if (!status) live.reserved(orgId, testId, attemptId, admitted, now);
      await withinLimit(rtdb.ref(`attemptOwners/${attemptId}`).set(who.uid), log, `attemptOwners/${attemptId}`);
      return { attemptId, ...(await issue(orgId, { testId, attemptId, ...who })) };
    },

    /** POST /v1/attempts/{id}/pairing-token: a new link for the caller's own attempt in progress (another's is 404). */
    async forAttempt(orgId: string, who: { uid: string; studentId: string }, attemptId: string): Promise<PairingToken> {
      const attempt = await data.attempts.getAttempt(orgId, attemptId);
      if (!attempt || attempt.studentId !== who.studentId) throw notFound('Attempt');
      if (attempt.status !== 'in_progress') throw finished();
      return issue(orgId, { testId: attempt.testId, attemptId, ...who });
    },

    /**
     * POST /v1/pairing/redeem (PR-14): a link works once and for 5 minutes on the Clock; it becomes a custom token for
     * the phone, whose claims let it write only its own presence record (DATA-10), and a new session. The session is
     * stored as the attempt's current phone before the reply (waiting at most OWNER_WRITE_LIMIT_MS, REL-05): the rules
     * accept only presence writes that carry it, so the phone this replaces can write no more.
     */
    async redeem(token: string): Promise<PairingRedeemResult> {
      const dot = token.indexOf('.');
      const orgId = token.slice(0, dot);
      const secret = token.slice(dot + 1);
      if (dot < 0 || !ORG_ID.test(orgId) || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw invalid();
      const now = clock.now();
      const done = await data.pairing.redeemToken(orgId, keyOf(secret), now, (r) => pairingTokenVerdict(r, now));
      if (!done) throw invalid();
      if (done === 'PAIRING_TOKEN_USED')
        throw new AppError(409, done, 'This pairing link has already been used. Show a new code on your laptop.');
      if (done === 'PAIRING_TOKEN_EXPIRED')
        throw new AppError(410, done, 'This pairing link has expired. Show a new code on your laptop.');
      const { testId, attemptId } = done.record;
      const customToken = await auth.createCustomToken(`device-${attemptId}`, { role: 'device', orgId, attemptId });
      const session = randomBytes(16).toString('base64url');
      const path = `${proctorPath(orgId, attemptId)}/phoneSession`;
      await withinLimit(rtdb.ref(path).set(session), log, path);
      return { customToken, orgId, testId, attemptId, session };
    },
  };
}
