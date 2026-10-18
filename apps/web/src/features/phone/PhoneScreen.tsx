'use client';

import { PHONE_HEARTBEAT_MS, presencePath, type PairingRedeemResult, type PhonePresence } from '@mitaoe/shared';
import { InlineMessage } from '@mitaoe/ui';
import { signInWithCustomToken } from 'firebase/auth';
import { serverTimestamp } from 'firebase/database';
import { useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { deviceFirebase } from '@/lib/firebase';
import { keepPresence, onConnected } from './presence';

type Refusal = 'used' | 'expired' | 'invalid' | 'failed';
type Link = 'connecting' | 'connected' | 'reconnecting';

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

/** Keeps the screen on while the page is shown; the browser drops the lock whenever the page is hidden (PR-15). */
function keepAwake(): () => void {
  let lock: WakeLockSentinel | null = null;
  let stopped = false;
  const request = () => {
    if (document.visibilityState !== 'visible' || !navigator.wakeLock) return;
    navigator.wakeLock
      .request('screen')
      .then((l) => (stopped ? void l.release() : (lock = l)))
      .catch(() => undefined);
  };
  request();
  document.addEventListener('visibilitychange', request);
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', request);
    void lock?.release().catch(() => undefined);
  };
}

/**
 * The pairing link opened on the phone (PR-14, PR-15, PR-17): it is redeemed for a device sign-in, the camera turns on
 * (shown here only; nothing of it is sent), the screen is kept awake, and the phone's presence record is written every
 * 5 seconds with an offline record left for when the connection drops (DATA-06).
 */
function usePhonePairing(token: string) {
  const [refusal, setRefusal] = useState<Refusal | null>(token ? null : 'invalid');
  const [link, setLink] = useState<Link>('connecting');
  const [cameraFailed, setCameraFailed] = useState(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  useEffect(() => {
    if (!token) return;
    let live = true;
    const stops: Array<() => void> = [];
    void (async () => {
      let paired: PairingRedeemResult;
      try {
        paired = await api<PairingRedeemResult>('/v1/pairing/redeem', { method: 'POST', body: { token } });
        const { auth, database } = deviceFirebase();
        await signInWithCustomToken(auth, paired.customToken);
        if (!live) return;
        stops.push(keepAwake());
        let cameraOn = false;
        const presence = keepPresence(
          database,
          presencePath(paired.orgId, paired.testId, paired.attemptId, 'phone'),
          (online): PhonePresence => ({
            online,
            lastSeen: serverTimestamp() as unknown as number,
            cameraOn: online && cameraOn,
          }),
        );
        const beat = setInterval(presence.refresh, PHONE_HEARTBEAT_MS);
        let wasUp = false;
        const offLink = onConnected(database, (up) => {
          if (up) wasUp = true;
          setLink(up ? 'connected' : wasUp ? 'reconnecting' : 'connecting');
        });
        stops.push(() => {
          clearInterval(beat);
          offLink();
          presence.stop();
        });
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: 'environment' } },
            audio: false,
          });
          if (!live) return stream.getTracks().forEach((tr) => tr.stop());
          stops.push(() => stream.getTracks().forEach((tr) => tr.stop()));
          setStream(stream);
          cameraOn = true;
          presence.refresh();
        } catch {
          if (live) setCameraFailed(true);
        }
      } catch (e) {
        if (live) setRefusal(refusalOf(e));
      }
    })();
    return () => {
      live = false;
      stops.forEach((stop) => stop());
    };
  }, [token]);
  return { refusal, link, cameraFailed, stream };
}

/** /pair/?token=<token> (spec 7.9, UX-12): designed for phones first. */
export function PhoneScreen() {
  const token = useSearchParams().get('token') ?? '';
  const video = useRef<HTMLVideoElement | null>(null);
  const { refusal, link, cameraFailed, stream } = usePhonePairing(token);
  useEffect(() => {
    const v = video.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    void v.play().catch(() => undefined);
  }, [stream]);
  const helpId = useId();
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex w-full max-w-student flex-col gap-5 px-4 py-6">
      <h1 className="font-display text-display-2 font-bold">{t('phone.title')}</h1>
      {refusal ? (
        <p role="alert" className="font-bold text-redpen">
          {t(REFUSALS[refusal])}
        </p>
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
          {cameraFailed ? <InlineMessage>{t('phone.cameraFailed')}</InlineMessage> : null}
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
        </>
      )}
    </main>
  );
}
