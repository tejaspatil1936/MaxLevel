'use client';

import type { ImportJobView } from '@mitaoe/shared';
import { Button, InlineMessage } from '@mitaoe/ui';
import { t } from '@/i18n';
import { formatCount, formatZonedTime } from '@/lib/format';

/** Whether the job is still being read: queued, running or waiting to retry. */
export const isRunning = (status: ImportJobView['status']) =>
  status === 'queued' || status === 'running' || status === 'retrying';

/**
 * IMP-04, REL-06: pages processed and questions found while the worker reads the file, with the time of the next try
 * while it waits to retry. The admin can leave: the job runs in the worker either way.
 */
export function JobProgress({ job, timeZone }: { job: ImportJobView; timeZone: string }) {
  const { pagesDone, pagesTotal, questionsFound } = job.progress;
  const percent = pagesTotal > 0 ? Math.round((pagesDone / pagesTotal) * 100) : 0;
  return (
    <section
      aria-label={t('imports.progress')}
      className="mb-6 flex max-w-measure flex-col gap-3 rounded-panel border border-rule bg-surface p-4"
    >
      <div
        role="progressbar"
        aria-label={t('imports.pagesBar')}
        aria-valuemin={0}
        aria-valuemax={pagesTotal}
        aria-valuenow={pagesTotal > 0 ? pagesDone : undefined}
        className="h-3 w-full overflow-hidden rounded-full border border-rule bg-surface-sunken"
      >
        <div className="h-full bg-ballpoint" style={{ width: `${percent}%` }} />
      </div>
      <p>{t('imports.pagesProcessed', { done: formatCount(pagesDone), total: formatCount(pagesTotal) })}</p>
      <p>{t('imports.questionsFound', { n: formatCount(questionsFound) })}</p>
      {job.status === 'retrying' && job.retryAt !== undefined ? (
        <p>{t('imports.retryAt', { time: formatZonedTime(job.retryAt, timeZone) })}</p>
      ) : null}
      <p className="text-graphite">{t('imports.leave')}</p>
    </section>
  );
}

/** A failed job says why, with `Try again` beside the message when the failure can be retried (REL-06). */
export function JobFailed({ job, retrying, onRetry }: { job: ImportJobView; retrying: boolean; onRetry: () => void }) {
  if (job.status !== 'failed' || !job.error) return null;
  return (
    <div className="mb-6 flex max-w-measure flex-col items-start gap-3">
      <InlineMessage>{t('imports.importFailed', { message: job.error.message })}</InlineMessage>
      {job.error.retryable ? (
        <Button variant="secondary" disabled={retrying} onClick={onRetry}>
          {t('imports.tryAgain')}
        </Button>
      ) : null}
    </div>
  );
}
