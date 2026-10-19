'use client';

import { signalPath, signalRecordSchema, type SignalRecord } from '@mitaoe/shared';
import { onValue, ref } from 'firebase/database';
import { useCallback, useEffect, useState } from 'react';
import { firebaseDatabase } from '@/lib/firebase';

/**
 * The deadline and notice the exam screen shows (OPS-06): a signal with a later deadline than the one the screen
 * opened with moves the timer and brings its notice, until the student dismisses that grant's notice. A signal the
 * opened deadline already holds (the screen opened after the grant) changes nothing and shows no notice.
 */
export function signalledDeadline(
  openedDeadline: number,
  signal: SignalRecord | null,
  dismissedDeadline: number | null,
): { deadlineAt: number; notice: string | null } {
  if (!signal || signal.deadlineAt <= openedDeadline) return { deadlineAt: openedDeadline, notice: null };
  return { deadlineAt: signal.deadlineAt, notice: signal.deadlineAt === dismissedDeadline ? null : signal.notice };
}

/**
 * The student's own `signals/{orgId}/{attemptId}` (spec 11.3, DATA-10), which the API writes on every grant of extra
 * time. Returns the deadline to count down to, the notice to show, the Dismiss action and `adopt`, which takes a deadline
 * the API sent. While the database can't be
 * reached the screen keeps the deadline it opened with (REL-05); the server's deadline still decides.
 */
export function useDeadlineSignal(orgId: string | null, attemptId: string, openedDeadline: number) {
  const [signal, setSignal] = useState<SignalRecord | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);
  useEffect(() => {
    if (!orgId || !attemptId) return;
    return onValue(
      ref(firebaseDatabase(), signalPath(orgId, attemptId)),
      (snap) => {
        const parsed = signalRecordSchema.safeParse(snap.val());
        setSignal(parsed.success ? parsed.data : null);
      },
      () => undefined,
    );
  }, [orgId, attemptId]);
  // A deadline the API answered with (a refused time-up, OPS-06) counts even before the signal arrives.
  const [known, setKnown] = useState(openedDeadline);
  const adopt = useCallback((deadlineAt: number) => setKnown((before) => Math.max(before, deadlineAt)), []);
  const shown = signalledDeadline(openedDeadline, signal, dismissed);
  return {
    ...shown,
    deadlineAt: Math.max(shown.deadlineAt, known),
    dismiss: () => setDismissed(shown.deadlineAt),
    adopt,
  };
}
