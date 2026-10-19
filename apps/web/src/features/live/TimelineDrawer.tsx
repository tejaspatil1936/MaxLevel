'use client';

import type { AttemptEvent, AttemptEventList } from '@mitaoe/shared';
import { Button, Drawer, InlineMessage, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatZonedSeconds } from '@/lib/format';
import { qk } from '@/lib/query-keys';

/** The event's label: its type's words, or a note's own text. */
function eventLabel(e: AttemptEvent): string {
  if (e.type === 'note') return typeof e.details.text === 'string' ? e.details.text : t('live.event.note');
  return t(`live.event.${e.type}`);
}

/**
 * View timeline (OPS-04, PR-11): an attempt's events in server-time order, each with its server time, its label and,
 * for a counted strike, its number. A non-modal drawer, so the roster stays in view; closing it returns focus to the
 * row's actions button (A11Y-05).
 */
export function TimelineDrawer(p: {
  orgId: string;
  attemptId: string;
  name: string;
  timezone: string;
  onClose: () => void;
}) {
  const events = useQuery({
    queryKey: qk.orgItem(p.orgId, 'attempt-events', p.attemptId),
    queryFn: () => api<AttemptEventList>(`/v1/attempts/${encodeURIComponent(p.attemptId)}/events`),
  });
  const items = events.data?.items;
  return (
    <Drawer
      open
      onOpenChange={(o) => !o && p.onClose()}
      title={t('live.timeline.title', { name: p.name })}
      footer={
        <Button variant="secondary" onClick={p.onClose}>
          {t('live.timeline.close')}
        </Button>
      }
    >
      {events.isError ? (
        <InlineMessage>{t('common.loadFailed')}</InlineMessage>
      ) : !items ? (
        <div role="status" aria-busy="true" aria-label={t('app.loading')}>
          <Skeleton className="h-40 w-full" />
        </div>
      ) : items.length === 0 ? (
        <p>{t('live.timeline.none')}</p>
      ) : (
        <ol aria-label={t('live.timeline.events')} className="flex flex-col divide-y divide-rule">
          {items.map((e) => (
            <li key={e.id} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3">
              <span className="tabular text-graphite">{formatZonedSeconds(e.serverTs, p.timezone)}</span>
              <span>{eventLabel(e)}</span>
              {e.strikeNumber ? (
                <span className="font-bold text-redpen">{t('live.timeline.strike', { n: e.strikeNumber })}</span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </Drawer>
  );
}
