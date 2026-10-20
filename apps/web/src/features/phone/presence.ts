'use client';

import { presencePath, type LaptopPresence } from '@mitaoe/shared';
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

/**
 * What the laptop sees of Realtime Database: its own connection, and whether the attempt's phone is online (a missing
 * record is offline). `phoneOnline` is null until the first answer.
 */
export function usePhoneLink(attempt: AttemptRef | null): { connected: boolean; phoneOnline: boolean | null } {
  const [connected, setConnected] = useState(false);
  const [phoneOnline, setPhoneOnline] = useState<boolean | null>(null);
  const path = attempt ? presencePath(attempt.orgId, attempt.testId, attempt.attemptId, 'phone') : null;
  useEffect(() => {
    if (!path) return;
    const db = firebaseDatabase();
    const offConnected = onConnected(db, setConnected);
    const offPhone = onValue(
      ref(db, path),
      (snap) => setPhoneOnline((snap.val() as { online?: unknown } | null)?.online === true),
      () => setPhoneOnline(null),
    );
    return () => {
      offConnected();
      offPhone();
      setPhoneOnline(null);
    };
  }, [path]);
  return { connected, phoneOnline };
}
