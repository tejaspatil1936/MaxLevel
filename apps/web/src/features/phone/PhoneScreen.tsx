'use client';

import {
  presencePath,
  proctorPath,
  proctorRecordSchema,
  type PairingRedeemResult,
  type PhoneCamera,
} from '@mitaoe/shared';
import { Button, InlineMessage } from '@mitaoe/ui';
import { signInWithCustomToken, type Auth } from 'firebase/auth';
import { onValue, ref } from 'firebase/database';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { deviceFirebase } from '@/lib/firebase';
import { keepCamera } from './phone-camera';
import { phonePresence } from './phone-presence';
import { forgetPairing, storedPairing, storePairing, type StoredPairing } from './phone-session';
import { onConnected } from './presence';

type Refusal = 'used' | 'expired' | 'invalid' | 'failed';
type Link = 'connecting' | 'connected' | 'reconnecting';
/** `ready` waits for the tap that starts everything; `replaced` and `ended` are final. */
type Phase = 'ready' | 'running' | 'replaced' | 'ended';

const REFUSALS: Record<Refusal, MessageKey> = {
  used: 'phone.used',
  expired: 'phone.expired',
  invalid: 'phone.invalid',
  failed: 'phone.failed',
};
const LINKS: Record<Link, MessageKey> = {
  connecting: 'phone.connecting',
  connected: 'phone.connected',
  reconnecting: 'phone.reconnecting',
};
const STEPS: MessageKey[] = ['phone.step1', 'phone.step2', 'phone.step3', 'phone.step4'];

const refusalOf = (e: unknown): Refusal => {
  if (!(e instanceof ApiError)) return 'failed';
  if (e.code === 'PAIRING_TOKEN_USED') return 'used';
  if (e.code === 'PAIRING_TOKEN_EXPIRED') return 'expired';
  return e.status === 404 || e.status === 400 ? 'invalid' : 'failed';
};

const shown = () => document.visibilityState === 'visible';

/** Calls `fn` whenever the page is shown again; returns a function that stops it. */
function onShown(fn: () => void): () => void {
  const listener = () => {
    if (shown()) fn();
  };
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

/**
 * Keeps the screen on while the page is shown (PR-15). The browser drops the lock whenever the page is hidden, and may
 * drop it on its own (low battery), so it is asked for again each time the page is shown and each time it is released.
 */
function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let stopped = false;
  const request = () => {
    if (stopped || !shown() || !navigator.wakeLock || (lock && !lock.released)) return;
    navigator.wakeLock
      .request('screen')
      .then((l) => {
        if (stopped) return void l.release();
        lock = l;
        l.addEventListener('release', () => setTimeout(request, 1_000));
      })
      .catch(() => undefined);
  };
  request();
  const off = onShown(request);
  return () => {
    stopped = true;
    off();
    void lock?.release().catch(() => undefined);
  };
}

/**
 * The pairing this link is for: the one this phone already holds for it (a reload rejoins with the device sign-in kept
 * on the phone), else the link redeemed now (PR-14), which works once.
 */
async function pair(auth: Auth, token: string): Promise<StoredPairing> {
  const stored = storedPairing(token);
  if (stored) {
    await auth.authStateReady();
    const claims = auth.currentUser ? (await auth.currentUser.getIdTokenResult()).claims : null;
    if (claims?.attemptId === stored.attemptId && claims.orgId === stored.orgId) return stored;
    forgetPairing();
  }
  const paired = await api<PairingRedeemResult>('/v1/pairing/redeem', { method: 'POST', body: { token } });
  await signInWithCustomToken(auth, paired.customToken);
  storePairing(token, paired);
  const { customToken: _token, ...rest } = paired;
  return { token, ...rest };
}

/**
 * The phone side of an attempt (PR-14 to PR-17). Nothing happens until the student taps Start camera, so a QR scanner
 * that opens the link in its own preview never uses it up, and the tap lets the browser start the camera and the wake
 * lock. Then: the camera (shown here only; nothing of it is sent) is kept open, the presence record carries its state,
 * and the page stops by itself when another phone takes over or the attempt ends.
 */
function usePhonePairing(token: string) {
  const [phase, setPhase] = useState<Phase>('ready');
  const [refusal, setRefusal] = useState<Refusal | null>(token ? null : 'invalid');
  const [link, setLink] = useState<Link>('connecting');
  const [camera, setCamera] = useState<PhoneCamera>('starting');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (!started) return;
    let live = true;
    const stops: Array<() => void> = [];
    const stopAll = () => {
      stops
        .splice(0)
        .reverse()
        .forEach((stop) => stop());
    };
    const end = (next: 'replaced' | 'ended') => {
      if (!live) return;
      stopAll();
      forgetPairing();
      setStream(null);
      setPhase(next);
    };
    void (async () => {
      const { auth, database } = deviceFirebase();
      let paired: StoredPairing;
      try {
        paired = await pair(auth, token);
      } catch (e) {
        if (live) setRefusal(refusalOf(e));
        return;
      }
      if (!live) return;
      setPhase('running');
      stops.push(keepAwake());
      let current: PhoneCamera = 'starting';
      const writer = phonePresence(
        database,
        presencePath(paired.orgId, paired.testId, paired.attemptId, 'phone'),
        paired.session,
        () => ({ camera: current, visible: shown() }),
      );
      stops.push(() => writer.stop());
      let wasUp = false;
      stops.push(
        onConnected(database, (up) => {
          if (up) wasUp = true;
          setLink(up ? 'connected' : wasUp ? 'reconnecting' : 'connecting');
        }),
      );
      const onPage = () => writer.changed();
      document.addEventListener('visibilitychange', onPage);
      stops.push(() => document.removeEventListener('visibilitychange', onPage));
      stops.push(
        onValue(
          ref(database, proctorPath(paired.orgId, paired.attemptId)),
          (snap) => {
            const record = proctorRecordSchema.safeParse(snap.val() ?? {});
            if (!record.success) return;
            if (record.data.phoneSession && record.data.phoneSession !== paired.session) end('replaced');
            else if (record.data.status && record.data.status !== 'in_progress') end('ended');
          },
          () => undefined,
        ),
      );
      stops.push(
        keepCamera(
          {
            open: () =>
              navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }),
            visible: shown,
            onShown,
            schedule: (fn, ms) => {
              const timer = setTimeout(fn, ms);
              return () => clearTimeout(timer);
            },
          },
          {
            state: (next) => {
              current = next;
              if (live) setCamera(next);
              writer.changed();
            },
            stream: (s) => live && setStream(s),
          },
        ),
      );
    })();
    return () => {
      live = false;
      stopAll();
    };
  }, [started, token]);
  return { phase, refusal, link, camera, stream, start: () => setStarted(true), started };
}

/** /pair/?token=<token> (spec 7.9, UX-12): designed for phones first. */
export function PhoneScreen() {
  const token = useSearchParams().get('token') ?? '';
  const video = useRef<HTMLVideoElement | null>(null);
  const { phase, refusal, link, camera, stream, start, started } = usePhonePairing(token);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    v.srcObject = stream;
    if (stream) void v.play().catch(() => undefined);
  }, [stream, phase]);
  const helpId = useId();
  const help = (
    <section aria-labelledby={helpId}>
      <h2 id={helpId} className="text-heading-2 font-bold">
        {t('phone.help')}
      </h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6">
        {STEPS.map((step) => (
          <li key={step}>{t(step)}</li>
        ))}
      </ol>
    </section>
  );
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-student flex-col gap-5 px-4 py-6">
      <h1 className="font-display text-display-2 font-bold">{t('phone.title')}</h1>
      {refusal ? (
        <p role="alert" className="font-bold text-redpen">
          {t(REFUSALS[refusal])}
        </p>
      ) : phase === 'replaced' || phase === 'ended' ? (
        <p role="status" className="font-bold">
          {t(phase === 'replaced' ? 'phone.replaced' : 'phone.ended')}
        </p>
      ) : phase === 'ready' ? (
        <>
          <p className="text-graphite">{t('phone.ready')}</p>
          <Button onClick={start} disabled={started}>
            {t('phone.start')}
          </Button>
          {help}
        </>
      ) : (
        <>
          <p role="status" className="font-bold">
            {t(LINKS[link])}
          </p>
          <p className="text-graphite">{t('phone.lead')}</p>
          <video
            ref={video}
            muted
            playsInline
            autoPlay
            aria-label={t('phone.preview')}
            className="aspect-[3/4] w-full rounded-panel border border-rule bg-surface-sunken object-cover"
          />
          {camera === 'failed' ? <InlineMessage>{t('phone.cameraFailed')}</InlineMessage> : null}
          {camera === 'paused' ? <InlineMessage>{t('phone.cameraPaused')}</InlineMessage> : null}
          {help}
        </>
      )}
    </main>
  );
}
