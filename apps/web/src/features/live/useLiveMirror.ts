'use client';

import { liveRecordSchema, liveTestPath, presenceTestPath, type LivePresence, type LiveRecord } from '@mitaoe/shared';
import { onValue, ref } from 'firebase/database';
import { useEffect, useState } from 'react';
import { firebaseDatabase } from '@/lib/firebase';

export interface LiveMirrorState {
  /** Null until the first snapshot arrives. */
  records: Record<string, LiveRecord> | null;
  presence: Record<string, LivePresence> | null;
  failed: boolean;
}

/** Records the API wrote, keyed by attempt ID; anything that doesn't parse is left out. */
function parseRecords(value: unknown): Record<string, LiveRecord> {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([id, v]) => {
      const parsed = liveRecordSchema.safeParse(v);
      return parsed.success ? [[id, parsed.data]] : [];
    }),
  );
}

const asPresence = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, LivePresence>) : {};

/**
 * The live view's Realtime Database subscription (OPS-02, PERF-04): `live/{orgId}/{testId}` and
 * `presence/{orgId}/{testId}`, read directly by the admin's browser under the database rules. Every status change
 * arrives here; the page never asks the API again.
 */
export function useLiveMirror(orgId: string, testId: string, enabled: boolean): LiveMirrorState {
  const [state, setState] = useState<LiveMirrorState>({ records: null, presence: null, failed: false });
  useEffect(() => {
    if (!enabled) return;
    const db = firebaseDatabase();
    const failed = () => setState((s) => ({ records: s.records ?? {}, presence: s.presence ?? {}, failed: true }));
    const offLive = onValue(
      ref(db, liveTestPath(orgId, testId)),
      (snap) => setState((s) => ({ ...s, records: parseRecords(snap.val()) })),
      failed,
    );
    const offPresence = onValue(
      ref(db, presenceTestPath(orgId, testId)),
      (snap) => setState((s) => ({ ...s, presence: asPresence(snap.val()) })),
      failed,
    );
    return () => {
      offLive();
      offPresence();
    };
  }, [orgId, testId, enabled]);
  return state;
}
