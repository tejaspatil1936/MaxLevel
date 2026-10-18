'use client';

import type { AttemptEventDetails, AttemptEventResult, AttemptPayload } from '@mitaoe/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, serverNow } from '@/lib/api';
import {
  createProctorReporter,
  type ClientEventType,
  type ProctorReporter,
  type StrikeWarning,
} from './proctor-events';

/**
 * The exam screen's proctoring reports (PR-08, PR-09, spec 11.2): `report` is what lockdown, the camera and the phone
 * presence call; `strikes` is the tally (the server's count) and `warning` the strike warning to show.
 */
export function useProctorReporter(
  payload: AttemptPayload,
  handlers: { onFinished: () => void; final: (error: unknown) => boolean },
) {
  const [strikes, setStrikes] = useState(payload.attempt.strikesCount);
  const [warning, setWarning] = useState<StrikeWarning | null>(null);
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });
  const reporter = useRef<ProctorReporter | null>(null);
  const attemptId = payload.attempt.id;
  const { devtoolsPolicy } = payload.settings;
  const opened = payload.attempt.strikesCount;
  useEffect(() => {
    const r = createProctorReporter({
      send: (body) =>
        api<AttemptEventResult>(`/v1/attempts/${encodeURIComponent(attemptId)}/events`, { method: 'POST', body }),
      now: serverNow,
      schedule: (fn, ms) => {
        const timer = setTimeout(fn, ms);
        return () => clearTimeout(timer);
      },
      devtoolsPolicy,
      strikesCount: opened,
      onCount: setStrikes,
      onWarning: setWarning,
      onFinished: () => latest.current.onFinished(),
      final: (e) => latest.current.final(e),
    });
    reporter.current = r;
    return () => r.dispose();
  }, [attemptId, devtoolsPolicy, opened]);

  const report = useCallback(
    (type: ClientEventType, details?: AttemptEventDetails) => reporter.current?.report(type, details),
    [],
  );
  const acknowledge = useCallback(() => reporter.current?.acknowledge(), []);
  return { strikes, warning, report, acknowledge };
}
