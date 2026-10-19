import type { ImportJobView } from '@mitaoe/shared';
import { t } from '@/i18n';
import { formatCount, formatZonedTime } from '@/lib/format';
import { isRunning } from './JobProgress';

/** A progress summary is said at most once every this many pages, so a long file does not flood the reader. */
export const ANNOUNCE_EVERY_PAGES = 5;

/** What the region last said of the job: its status, and the pages done at the last progress summary. */
export interface Announced {
  status: ImportJobView['status'];
  pagesDone: number;
}

type JobState = Pick<ImportJobView, 'status' | 'progress' | 'error'> & { retryAt?: number };

const progressText = ({ pagesDone, pagesTotal, questionsFound }: JobState['progress']) =>
  t('imports.announce.progress', {
    done: formatCount(pagesDone),
    total: formatCount(pagesTotal),
    n: formatCount(questionsFound),
  });

/** A new status, with what the page shows beside it: the retry time, and the pages done since the last summary. */
function statusText(job: JobState, last: Announced, timeZone: string): string {
  const n = formatCount(job.progress.questionsFound);
  if (job.status === 'ready') return t('imports.announce.ready', { n });
  if (job.status === 'failed') return t('imports.announce.failed', { message: job.error?.message ?? '' }).trim();
  const said = [t('imports.announce.status', { status: t(`imports.status.${job.status}`) })];
  if (job.progress.pagesDone > last.pagesDone) said.push(progressText(job.progress));
  if (job.status === 'retrying' && job.retryAt !== undefined)
    said.push(t('imports.retryAt', { time: formatZonedTime(job.retryAt, timeZone) }));
  return said.join('. ');
}

/**
 * IMP-04, WCAG 4.1.3: what the review page's polite status region says when the polled job view changes. The view
 * the page opens with says nothing (the page shows it); a new status is said at once (`Processing`, `Ready for
 * review` with the questions found, `Failed` with why, `Waiting to retry` with the time of the next try in
 * `timeZone`), with the pages processed when more are done than the last summary said; while the job runs, the pages processed and questions found
 * are said once at least ANNOUNCE_EVERY_PAGES more pages are done, or when the last page is. `text` is null when
 * nothing is to be said.
 */
export function nextAnnouncement(
  last: Announced | null,
  job: JobState,
  timeZone = 'Asia/Kolkata',
): { text: string | null; last: Announced } {
  const now = { status: job.status, pagesDone: job.progress.pagesDone };
  if (!last) return { text: null, last: now };
  if (job.status !== last.status) return { text: statusText(job, last, timeZone), last: now };
  const { pagesDone, pagesTotal } = job.progress;
  const step = pagesDone - last.pagesDone;
  if (!isRunning(job.status) || step <= 0 || (step < ANNOUNCE_EVERY_PAGES && pagesDone < pagesTotal))
    return { text: null, last };
  return { text: progressText(job.progress), last: now };
}
