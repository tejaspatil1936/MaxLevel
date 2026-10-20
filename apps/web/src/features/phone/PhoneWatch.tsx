'use client';

import {
  type AttemptEventDetails,
  initialPhoneWatch,
  nextPhoneWatch,
  type PairingToken,
  type PhoneLink,
} from '@mitaoe/shared';
import { Dialog } from '@mitaoe/ui';
import { Smartphone } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { PairingCode, usePairingCode } from './PairingCode';
import { usePhoneLink, type AttemptRef } from './presence';

/** How often the laptop looks at the phone's presence to time a disconnection. */
const LOOK_MS = 1000;

/**
 * The laptop watching its phone during the attempt (PR-16, REL-05): the phone's presence, judged once a second by
 * shared `nextPhoneWatch`. A disconnection of more than 15 seconds needs the reconnect overlay, of more than 60 seconds
 * one `phone_disconnected` report; nothing is timed while the laptop's own Realtime Database connection is down.
 * Durations are on the monotonic clock, so a re-measured server offset never stretches or shortens them.
 */
export function usePhoneWatch(
  attempt: AttemptRef | null,
  report: (type: 'phone_disconnected', details: AttemptEventDetails) => void,
): { link: PhoneLink; reconnect: boolean } {
  const { connected, phoneOnline } = usePhoneLink(attempt);
  const [view, setView] = useState<{ link: PhoneLink; reconnect: boolean }>({ link: 'unavailable', reconnect: false });
  const watch = useRef(initialPhoneWatch);
  const watching = attempt !== null;
  useEffect(() => {
    if (!watching) return;
    const look = () => {
      const seen = { laptopConnected: connected && phoneOnline !== null, phoneOnline: phoneOnline === true };
      const next = nextPhoneWatch(watch.current, seen, performance.now());
      watch.current = next.state;
      setView((v) =>
        v.link === next.link && v.reconnect === next.reconnect ? v : { link: next.link, reconnect: next.reconnect },
      );
      if (next.report) report('phone_disconnected', { disconnectedMs: Math.round(next.report.afterMs) });
    };
    const first = setTimeout(look, 0);
    const id = setInterval(look, LOOK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [watching, connected, phoneOnline, report]);
  return { link: view.link, reconnect: view.reconnect };
}

const LINK_TEXT: Record<PhoneLink, MessageKey> = {
  connected: 'phoneStatus.connected',
  disconnected: 'phoneStatus.disconnected',
  unavailable: 'phoneStatus.unavailable',
};

/** The phone's state in the exam banner (second camera only). */
export function PhoneStatus({ link }: { link: PhoneLink }) {
  return (
    <p className="flex items-center gap-2">
      <Smartphone
        aria-hidden
        size={20}
        className={link === 'connected' ? 'text-tick' : link === 'disconnected' ? 'text-redpen' : 'text-graphite'}
      />
      <span className={link === 'disconnected' ? 'font-bold text-redpen' : undefined}>{t(LINK_TEXT[link])}</span>
    </p>
  );
}

function FreshCode({ orgId, attemptId, timezone }: { orgId: string; attemptId: string; timezone: string | null }) {
  const pairing = usePairingCode(qk.orgItem(orgId, 'pairing', attemptId), () =>
    api<PairingToken>(`/v1/attempts/${encodeURIComponent(attemptId)}/pairing-token`, { method: 'POST', body: {} }),
  );
  return <PairingCode pairing={pairing} timezone={timezone} />;
}

/**
 * The blocking overlay of PR-16: open while the phone has been gone for more than 15 seconds, with a fresh code
 * (asked for each time it opens). Only the phone coming back closes it; Escape and clicks outside do nothing.
 */
export function ReconnectPhone({
  open,
  attempt,
  timezone,
}: {
  open: boolean;
  attempt: AttemptRef;
  timezone: string | null;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={() => undefined}
      title={t('pairing.reconnectTitle')}
      description={t('pairing.reconnect')}
    >
      <FreshCode orgId={attempt.orgId} attemptId={attempt.attemptId} timezone={timezone} />
    </Dialog>
  );
}
