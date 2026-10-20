'use client';

import { lastSeenOf, timeLeftOf, type LiveRow, type LiveRowStatus, type LiveSortKey } from '@mitaoe/shared';
import { Button, Menu, StatusPill, Table, type Column, type MenuItem, type Tone } from '@mitaoe/ui';
import { MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { formatCount, formatExamTimer } from '@/lib/format';

const TONES: Record<LiveRowStatus, Tone> = {
  not_started: 'muted',
  pairing: 'neutral',
  in_progress: 'info',
  submitted: 'success',
  auto_submitted: 'success',
  terminated: 'danger',
};

/** `Online`, `<n> s ago`, `<n> min ago` (whole minutes, rounded down) or `Not seen`; empty unless in progress. */
function lastSeenText(row: LiveRow, now: number): string {
  const seen = lastSeenOf(row, now);
  if (!seen) return '';
  if (seen.kind === 'online') return t('live.seen.online');
  if (seen.kind === 'not_seen') return t('live.seen.never');
  const s = Math.floor(seen.ms / 1000);
  return s < 60 ? t('live.seen.seconds', { n: s }) : t('live.seen.minutes', { n: formatCount(Math.floor(s / 60)) });
}

/** Rows with row actions: an attempt that started (OPS-04); not started and pairing rows have none. */
const hasActions = (row: LiveRow) => row.status !== 'not_started' && row.status !== 'pairing';

/**
 * The live view's roster (OPS-01, OPS-03): one row per student with status, answered out of total, strikes, phone,
 * last seen and time left by the server's clock, sortable on every column but Actions. The row actions menu gets
 * its items from `actions`, which the live view builds from the features that own them (OPS-04).
 */
export function LiveRoster(p: {
  rows: LiveRow[];
  now: number;
  sort: { key: LiveSortKey; dir: 'asc' | 'desc' };
  onSortChange: (sort: { key: LiveSortKey; dir: 'asc' | 'desc' }) => void;
  empty: ReactNode;
  /** The row actions menu of a started row, in the contract's order. */
  actions: (row: LiveRow) => MenuItem[];
}) {
  const sortable = (key: LiveSortKey, header: string, cell: (r: LiveRow) => ReactNode): Column<LiveRow> => ({
    key,
    header,
    cell,
    sortable: true,
  });
  const columns: Array<Column<LiveRow>> = [
    sortable('student', t('live.col.student'), (r) => r.name),
    sortable('prn', t('live.col.prn'), (r) => r.prn),
    sortable('status', t('live.col.status'), (r) => (
      <StatusPill tone={TONES[r.status]}>{t(`live.status.${r.status}`)}</StatusPill>
    )),
    sortable('answered', t('live.col.answered'), (r) =>
      r.answered === null || r.total === null
        ? ''
        : t('live.answered', { answered: formatCount(r.answered), total: formatCount(r.total) }),
    ),
    sortable('strikes', t('live.col.strikes'), (r) => (r.strikes === null ? '' : formatCount(r.strikes))),
    sortable('phone', t('live.col.phone'), (r) => (r.phone ? t(`live.phone.${r.phone}`) : '')),
    sortable('lastSeen', t('live.col.lastSeen'), (r) => lastSeenText(r, p.now)),
    sortable('timeLeft', t('live.col.timeLeft'), (r) => {
      const left = timeLeftOf(r, p.now);
      return left === null ? '' : <span className="tabular">{formatExamTimer(left)}</span>;
    }),
    {
      key: 'actions',
      header: t('live.col.actions'),
      cell: (r) =>
        hasActions(r) ? (
          <Menu
            label={t('live.actionsFor', { name: r.name })}
            items={p.actions(r)}
            trigger={
              <Button variant="ghost" className="px-2">
                <MoreHorizontal aria-hidden size={20} />
              </Button>
            }
          />
        ) : null,
    },
  ];
  return (
    <Table
      caption={t('live.roster')}
      density="compact"
      columns={columns}
      rows={p.rows}
      rowKey={(r) => r.studentId}
      sort={p.sort}
      // A third press on the same column sorts it ascending again (the first press always sorts ascending).
      onSortChange={(next) =>
        p.onSortChange(next ? { key: next.key as LiveSortKey, dir: next.dir } : { key: p.sort.key, dir: 'asc' })
      }
      empty={p.empty}
    />
  );
}
