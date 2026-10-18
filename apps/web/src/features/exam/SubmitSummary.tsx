'use client';

import { ConfirmDialog, InlineMessage, Table } from '@mitaoe/ui';
import { t } from '@/i18n';
import { formatCount } from '@/lib/format';

export interface SummaryRow {
  name: string;
  answered: number;
  notAnswered: number;
  marked: number;
}

/**
 * Submit test? (EX-15, UX-03): answered, not answered and marked questions per section, focus on Cancel. Confirming
 * waits until every answer is saved; the submit itself and its offline retries are F-3.08's.
 */
export function SubmitSummary({
  open,
  onOpenChange,
  rows,
  saved,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: SummaryRow[];
  saved: boolean;
  error: boolean;
  onConfirm: () => void;
}) {
  const count = (n: number) => formatCount(n);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('attempt.summaryTitle')}
      description={t('attempt.summaryBody')}
      cancelLabel={t('common.cancel')}
      confirmLabel={t('attempt.submit')}
      confirmDisabled={!saved}
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
      {!saved ? <p className="mt-3 text-graphite">{t('attempt.summaryWaiting')}</p> : null}
      {error ? (
        <div className="mt-3">
          <InlineMessage>{t('attempt.submitFailed')}</InlineMessage>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
