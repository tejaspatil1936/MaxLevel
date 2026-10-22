'use client';

import { proctorPath, serverStrikeSchema, type ServerStrike } from '@mitaoe/shared';
import { onValue, ref } from 'firebase/database';
import { useEffect } from 'react';
import { firebaseDatabase } from '@/lib/firebase';

/**
 * The strikes the server decided on its own (a phone outage, PR-16), from the student's own
 * `proctor/{orgId}/{attemptId}/strike` (DATA-10). While the database can't be reached nothing arrives; the strike is
 * still stored, and the next report's answer carries the count (REL-05).
 */
export function useServerStrikes(
  orgId: string | null,
  attemptId: string,
  onStrike: (strike: ServerStrike) => void,
): void {
  useEffect(() => {
    if (!orgId || !attemptId) return;
    return onValue(
      ref(firebaseDatabase(), `${proctorPath(orgId, attemptId)}/strike`),
      (snap) => {
        const parsed = serverStrikeSchema.safeParse(snap.val());
        if (parsed.success) onStrike(parsed.data);
      },
      () => undefined,
    );
  }, [orgId, attemptId, onStrike]);
}
