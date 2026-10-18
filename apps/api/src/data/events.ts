import type { AttemptEvent, AttemptEventReport, AttemptRecord, StrikeVerdict } from '@mitaoe/shared';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import { toAttempt } from './attempts';

/** What recording one event did: the attempt as it now stands, the verdict and the stored event. */
export interface RecordedEvent {
  attempt: AttemptRecord;
  verdict: StrikeVerdict;
  event: AttemptEvent;
}

const toEvent = (d: DocumentSnapshot): AttemptEvent => {
  const strikeNumber = d.get('strikeNumber') as number | undefined;
  return {
    id: d.id,
    type: d.get('type') as AttemptEvent['type'],
    details: (d.get('details') as Record<string, unknown> | undefined) ?? {},
    clientTs: d.get('clientTs') as number,
    serverTs: d.get('serverTs') as number,
    ...(strikeNumber !== undefined ? { strikeNumber } : {}),
  };
};

/** Proctoring events of an attempt (organizations/{orgId}/attempts/{attemptId}/events, PR-11). */
export function eventsData(db: Firestore) {
  const attemptRef = (orgId: string, attemptId: string) => db.doc(`organizations/${orgId}/attempts/${attemptId}`);

  return {
    /**
     * PR-07, PR-08, PR-11: logs one event and counts it in one transaction on the attempt. `decide` sees the attempt
     * as stored (its `strikesCount` and `lastStrikeAt`, never the client's count); a counted event sets both and
     * carries its `strikeNumber`, so concurrent reports never lose or repeat a count. Every event is stored, counted
     * or not. `ATTEMPT_FINISHED` (and nothing stored) once the attempt is not in progress; null when there is none.
     */
    async recordEvent(
      orgId: string,
      attemptId: string,
      report: AttemptEventReport,
      serverTs: number,
      decide: (attempt: AttemptRecord) => StrikeVerdict,
    ): Promise<RecordedEvent | 'ATTEMPT_FINISHED' | null> {
      const ref = attemptRef(orgId, attemptId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        const stored = toAttempt(snap);
        if (stored.status !== 'in_progress') return 'ATTEMPT_FINISHED';
        const verdict = decide(stored);
        const strikeNumber = verdict.counted ? verdict.strikeNumber : undefined;
        const eventRef = ref.collection('events').doc();
        const event: AttemptEvent = {
          id: eventRef.id,
          type: report.type,
          details: report.details,
          clientTs: report.clientTs,
          serverTs,
          ...(strikeNumber !== undefined ? { strikeNumber } : {}),
        };
        const { id: _id, ...fields } = event;
        tx.create(eventRef, { orgId, ...fields });
        if (strikeNumber === undefined) return { attempt: stored, verdict, event };
        tx.update(ref, { strikesCount: strikeNumber, lastStrikeAt: serverTs });
        return { attempt: { ...stored, strikesCount: strikeNumber, lastStrikeAt: serverTs }, verdict, event };
      });
    },

    /**
     * PR-11: an attempt's events in `serverTs` order; events stored in the same millisecond keep the order they were
     * written in (their create time). Empty for an attempt of another organization.
     */
    async listEvents(orgId: string, attemptId: string): Promise<AttemptEvent[]> {
      const snap = await attemptRef(orgId, attemptId).collection('events').get();
      // Timestamp.valueOf() is a string that sorts in time order.
      return snap.docs
        .map((d) => ({ event: toEvent(d), created: d.createTime.valueOf() }))
        .sort((a, b) => a.event.serverTs - b.event.serverTs || a.created.localeCompare(b.created))
        .map(({ event }) => event);
    },
  };
}
