'use client';

import { ConfirmDialog, InlineMessage, Table } from '@mitaoe/ui';
import { t } from '@/i18n';
import { formatCount } from '@/lib/format';
import type { SubmitPhase } from './submission';

export interface SummaryRow {
  name: string;
  answered: number;
  notAnswered: number;
  marked: number;
}

/**
 * Submit test? (EX-15, UX-03): answered, not answered and marked questions per section, focus on Cancel. Confirming
 * syncs every waiting answer, then submits; while the submit can't reach the API the dialog says so and keeps trying.
 */
export function SubmitSummary({
  open,
  onOpenChange,
  rows,
  saved,
  phase,
  offline,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: SummaryRow[];
  saved: boolean;
  phase: SubmitPhase;
  /** The submit (or the answer sync before it) can't reach the API. */
  offline: boolean;
  onConfirm: () => void;
}) {
  const count = (n: number) => formatCount(n);
  const busy = phase === 'saving' || phase === 'sending' || phase === 'offline';
  const progress = offline ? t('attempt.submitOffline') : busy ? t('attempt.submitting') : '';
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('attempt.summaryTitle')}
      description={t('attempt.summaryBody')}
      cancelLabel={t('common.cancel')}
      confirmLabel={t('attempt.submit')}
      confirmDisabled={busy || phase === 'done'}
      onConfirm={onConfirm}
    >
      <Table
        caption={t('attempt.summaryTable')}
        rows={rows}
        rowKey={(r) => r.name}
        density="compact"
        columns={[
          { key: 'section', header: t('attempt.summarySection'), cell: (r) => r.name },
          { key: 'answered', header: t('attempt.summaryAnswered'), cell: (r) => count(r.answered), align: 'end' },
          {
            key: 'notAnswered',
            header: t('attempt.summaryNotAnswered'),
            cell: (r) => count(r.notAnswered),
            align: 'end',
          },
          { key: 'marked', header: t('attempt.summaryMarked'), cell: (r) => count(r.marked), align: 'end' },
        ]}
      />
      {!saved && !busy ? <p className="mt-3 text-graphite">{t('attempt.summaryWaiting')}</p> : null}
      <p role="status" className={offline ? 'mt-3 font-bold text-redpen' : 'mt-3 text-graphite'}>
        {progress}
      </p>
      {phase === 'failed' ? (
        <div className="mt-3">
          <InlineMessage>{t('attempt.submitFailed')}</InlineMessage>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
