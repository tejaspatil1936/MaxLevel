import { PHONE_HEARTBEAT_MS, type PhoneCamera, type PhonePresence } from '@mitaoe/shared';
import {
  onDisconnect,
  ref,
  serverTimestamp,
  set,
  update,
  type Database,
  type DatabaseReference,
} from 'firebase/database';
import { onConnected } from './presence';

// The phone's presence record (PR-15, PR-16, DATA-06): written in full whenever the connection comes up, then a
// heartbeat every 5 seconds and a change whenever the camera or the page changes; partial writes wait for the full one,
// since the rules refuse a record without its required fields. `stateSince` moves only when the phone turns healthy or
// unhealthy, so one outage keeps one value. Every write, the offline record left for a dropped connection included,
// carries this pairing's session, which the rules check (DATA-10), so a replaced phone writes nothing more. A refused
// write is retried in full on the next heartbeat; whether the phone was replaced is read from the proctor record.

export interface PhoneState {
  camera: PhoneCamera;
  visible: boolean;
}

export interface PhonePresenceWriter {
  /** The camera or the page changed. */
  changed(): void;
  /** Leaves the record offline and stops writing (the exam ended, or another phone took over). */
  stop(): void;
}

const at = () => serverTimestamp() as unknown as number;

export function phonePresence(
  db: Database,
  path: string,
  session: string,
  state: () => PhoneState,
): PhonePresenceWriter {
  const target: DatabaseReference = ref(db, path);
  let up = false;
  /** The full record of this connection is stored; partial writes may follow. */
  let written = false;
  let writing = false;
  /** A change came while the full record was being written: it is applied once that write lands. */
  let dirty = false;
  let healthy: boolean | null = null;
  let stopped = false;

  const guard = (write: Promise<unknown>) =>
    void write.catch(() => {
      written = false;
    });
  /** The whole offline record: the rules refuse a partial write where no record exists yet. */
  const offline = (): PhonePresence => ({
    online: false,
    lastSeen: at(),
    cameraOn: false,
    camera: state().camera,
    visible: false,
    session,
    stateSince: at(),
  });
  const full = (): PhonePresence => {
    const { camera, visible } = state();
    healthy = camera === 'live';
    return { online: true, lastSeen: at(), cameraOn: healthy, camera, visible, session, stateSince: at() };
  };

  /** A new connection is a new state: the record is written whole, after its offline record is in place. */
  const writeFull = () => {
    if (!up || stopped || writing) return;
    writing = true;
    void onDisconnect(target)
      .set(offline())
      .then(() => set(target, full()))
      .then(
        () => void (written = up),
        () => void (written = false),
      )
      .finally(() => {
        writing = false;
        if (dirty && written) {
          dirty = false;
          writer.changed();
        }
      });
  };
  const offConnected = onConnected(db, (connected) => {
    up = connected;
    written = false;
    if (connected) writeFull();
  });
  const beat = setInterval(() => {
    if (!up || stopped) return;
    if (written) guard(update(target, { lastSeen: at(), session }));
    else writeFull();
  }, PHONE_HEARTBEAT_MS);

  const writer: PhonePresenceWriter = {
    changed() {
      if (!up || stopped) return;
      if (!written) {
        dirty = writing;
        return writeFull();
      }
      const { camera, visible } = state();
      const now = camera === 'live';
      if (now !== healthy) {
        healthy = now;
        guard(update(target, { camera, cameraOn: now, visible, lastSeen: at(), stateSince: at(), session }));
      } else guard(update(target, { camera, cameraOn: now, visible, session }));
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearInterval(beat);
      offConnected();
      void onDisconnect(target)
        .cancel()
        .catch(() => undefined);
      if (up) guard(set(target, offline()));
    },
  };
  return writer;
}
