'use client';

import type { PairingToken } from '@mitaoe/shared';
import { Button, InlineMessage } from '@mitaoe/ui';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { t } from '@/i18n';
import { ApiError, serverNow } from '@/lib/api';
import { formatZonedTime } from '@/lib/format';
import { PairingQr } from './PairingQr';

const PAIRING_ERRORS = ['WINDOW_NOT_OPEN', 'WINDOW_CLOSED', 'ATTEMPT_FINISHED', 'NOT_ELIGIBLE'] as const;

export interface PairingCodeState<T extends PairingToken = PairingToken> {
  code: T | null;
  expired: boolean;
  error: unknown;
  fetching: boolean;
  newCode: () => void;
}

/**
 * A pairing code from the API (PR-13), asked for once when `enabled` and again with `New code`. It counts as expired
 * from its `expiresAt` on the server clock (EX-06), since the link stops working then.
 */
export function usePairingCode<T extends PairingToken>(
  key: QueryKey,
  request: () => Promise<T>,
  enabled = true,
): PairingCodeState<T> {
  const query = useQuery({
    queryKey: key,
    queryFn: request,
    enabled,
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const expiresAt = query.data?.expiresAt;
  const [expiredAt, setExpiredAt] = useState<number | null>(null);
  useEffect(() => {
    if (expiresAt === undefined) return;
    const tick = () => {
      if (serverNow() >= expiresAt) setExpiredAt(expiresAt);
    };
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return {
    code: query.data ?? null,
    expired: expiresAt !== undefined && expiredAt === expiresAt,
    error: query.error,
    fetching: query.isFetching,
    newCode: () => void query.refetch(),
  };
}

/**
 * The code itself: the QR code and the link as text to type on the phone (test ID `pairing-link`), when it expires
 * in the organization's timezone, and `New code`. An expired code is replaced by `This code has expired.`.
 */
export function PairingCode({ pairing, timezone }: { pairing: PairingCodeState; timezone: string | null }) {
  const { code, expired, error, fetching, newCode } = pairing;
  const failure = error instanceof ApiError ? error.code : '';
  const reason = (PAIRING_ERRORS as readonly string[]).includes(failure)
    ? t(`rules.error.${failure as (typeof PAIRING_ERRORS)[number]}`)
    : t('rules.error.other');
  return (
    <div className="flex flex-wrap items-start gap-6">
      {code && !expired ? <PairingQr url={code.url} /> : null}
      <div className="flex min-w-0 max-w-full flex-col items-start gap-3">
        {code && !expired ? (
          <>
            <p data-testid="pairing-link" className="max-w-full break-all font-code text-body-small">
              {code.url}
            </p>
            {timezone ? <p>{t('pairing.expiresAt', { time: formatZonedTime(code.expiresAt, timezone) })}</p> : null}
          </>
        ) : null}
        {expired ? <p className="font-bold">{t('pairing.expired')}</p> : null}
        {error ? <InlineMessage>{t('pairing.loadFailed', { reason })}</InlineMessage> : null}
        {code || error ? (
          <Button variant="secondary" onClick={newCode} disabled={fetching}>
            {t('pairing.newCode')}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
