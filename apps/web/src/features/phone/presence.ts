'use client';

import { phoneHealthy, presencePath, type LaptopPresence, type PhonePresence } from '@mitaoe/shared';
import {
  onDisconnect,
  onValue,
  ref,
  serverTimestamp,
  set,
  update,
  type Database,
  type DatabaseReference,
} from 'firebase/database';
import { useEffect, useState } from 'react';
import { firebaseDatabase } from '@/lib/firebase';

// Presence in Realtime Database (spec 10.2, DATA-06): each device writes its own record with `onDisconnect`, so a
// closed tab or a dropped phone shows offline at once; the laptop listens to the phone's record (PR-16).

export interface AttemptRef {
  orgId: string;
  testId: string;
  attemptId: string;
}

/** `.info/connected`: whether this browser's own Realtime Database connection is up (REL-05). */
export function onConnected(db: Database, listener: (connected: boolean) => void): () => void {
  return onValue(ref(db, '.info/connected'), (snap) => listener(snap.val() === true));
}

/**
 * Keeps a device's presence record while `connected` holds: every time the connection comes up the offline record is
 * left with the server first (`onDisconnect`), then the online record is written. Returns a function that stops.
 */
export function keepPresence<T extends { online: boolean }>(
  db: Database,
  path: string,
  record: (online: boolean) => T,
): { stop: () => void; refresh: () => void; target: DatabaseReference } {
  const target = ref(db, path);
  let up = false;
  const write = () => void set(target, record(true)).catch(() => undefined);
  const unsubscribe = onConnected(db, (connected) => {
    up = connected;
    if (!connected) return;
    void onDisconnect(target)
      .set(record(false))
      .then(write)
      .catch(() => undefined);
  });
  return {
    target,
    refresh: () => {
      if (up) write();
    },
    stop: () => {
      unsubscribe();
      void onDisconnect(target)
        .cancel()
        .catch(() => undefined);
      void update(target, { online: false, lastSeen: serverTimestamp() }).catch(() => undefined);
    },
  };
}

/** The laptop's own presence during an attempt (DATA-06): online, fullscreen and whether the exam tab is visible. */
export function useLaptopPresence(attempt: AttemptRef | null): void {
  const path = attempt ? presencePath(attempt.orgId, attempt.testId, attempt.attemptId, 'laptop') : null;
  useEffect(() => {
    if (!path) return;
    const record = (online: boolean): LaptopPresence => ({
      online,
      lastSeen: serverTimestamp() as unknown as number,
      fullscreen: online && !!document.fullscreenElement,
      visible: online && document.visibilityState === 'visible',
    });
    const presence = keepPresence(firebaseDatabase(), path, record);
    const changed = () => presence.refresh();
    document.addEventListener('fullscreenchange', changed);
    document.addEventListener('visibilitychange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      document.removeEventListener('visibilitychange', changed);
      presence.stop();
    };
  }, [path]);
}

/** What the laptop knows of the phone's record: its health and the outage key, and when it last changed here. */
export interface PhoneView {
  healthy: boolean;
  stateSince: number | null;
  lastSeen: number | null;
  /** The laptop's monotonic time the record's `lastSeen` last changed (or was first seen). */
  changedAt: number;
}

/**
 * What the laptop sees of Realtime Database: its own connection, and the attempt's phone record (a missing record is
 * an unhealthy phone). `phone` is undefined until the first answer and null when the record can't be read.
 * `phoneOnline` is the phone healthy (online with a live camera), null until the first answer.
 */
export function usePhoneLink(attempt: AttemptRef | null): {
  connected: boolean;
  phone: PhoneView | null | undefined;
  phoneOnline: boolean | null;
} {
  const [connected, setConnected] = useState(false);
  const [phone, setPhone] = useState<PhoneView | null | undefined>(undefined);
  const path = attempt ? presencePath(attempt.orgId, attempt.testId, attempt.attemptId, 'phone') : null;
  useEffect(() => {
    if (!path) return;
    const db = firebaseDatabase();
    const offConnected = onConnected(db, setConnected);
    const offPhone = onValue(
      ref(db, path),
      (snap) => {
        const record = snap.val() as Partial<PhonePresence> | null;
        const num = (v: unknown) => (typeof v === 'number' ? v : null);
        const lastSeen = num(record?.lastSeen);
        setPhone((before) => ({
          healthy: phoneHealthy(record),
          stateSince: num(record?.stateSince),
          lastSeen,
          changedAt: before && before.lastSeen === lastSeen ? before.changedAt : performance.now(),
        }));
      },
      () => setPhone(null),
    );
    return () => {
      offConnected();
      offPhone();
      setPhone(undefined);
    };
  }, [path]);
  return { connected, phone, phoneOnline: phone === undefined || phone === null ? null : phone.healthy };
}
