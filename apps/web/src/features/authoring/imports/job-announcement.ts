import type { ImportJobView } from '@mitaoe/shared';
import { t } from '@/i18n';
import { formatCount } from '@/lib/format';
import { isRunning } from './JobProgress';

/** A progress summary is said at most once every this many pages, so a long file does not flood the reader. */
export const ANNOUNCE_EVERY_PAGES = 5;

/** What the region last said of the job: its status, and the pages done at the last progress summary. */
export interface Announced {
  status: ImportJobView['status'];
  pagesDone: number;
}

type JobState = Pick<ImportJobView, 'status' | 'progress' | 'error'>;

function statusText(job: JobState): string {
  const n = formatCount(job.progress.questionsFound);
  if (job.status === 'ready') return t('imports.announce.ready', { n });
  if (job.status === 'failed') return t('imports.announce.failed', { message: job.error?.message ?? '' }).trim();
  return t('imports.announce.status', { status: t(`imports.status.${job.status}`) });
}

/**
 * IMP-04, WCAG 4.1.3: what the review page's polite status region says when the polled job view changes. The view
 * the page opens with says nothing (the page shows it); a new status is said at once (`Processing`, `Ready for
 * review` with the questions found, `Failed` with why); while the job runs, the pages processed and questions found
 * are said once at least ANNOUNCE_EVERY_PAGES more pages are done, or when the last page is. `text` is null when
 * nothing is to be said.
 */
export function nextAnnouncement(last: Announced | null, job: JobState): { text: string | null; last: Announced } {
  const now = { status: job.status, pagesDone: job.progress.pagesDone };
  if (!last) return { text: null, last: now };
  if (job.status !== last.status) return { text: statusText(job), last: now };
  const { pagesDone, pagesTotal, questionsFound } = job.progress;
  const step = pagesDone - last.pagesDone;
  if (!isRunning(job.status) || step <= 0 || (step < ANNOUNCE_EVERY_PAGES && pagesDone < pagesTotal))
    return { text: null, last };
  const text = t('imports.announce.progress', {
    done: formatCount(pagesDone),
    total: formatCount(pagesTotal),
    n: formatCount(questionsFound),
  });
  return { text, last: now };
}
