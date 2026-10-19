'use client';

import type { ImportList } from '@mitaoe/shared';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatZonedDay, formatZonedTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { statusWordKey } from './review-order';

export const importReviewUrl = (jobId: string) => `/admin/imports/review/?id=${encodeURIComponent(jobId)}`;

/** `20 Oct 2026, 11:30 IST`, in the organization's timezone. */
export function formatStarted(ms: number, timeZone: string): string {
  return t('time.dayTime', { date: formatZonedDay(ms, timeZone), time: formatZonedTime(ms, timeZone) });
}

/**
 * IMP-04: the test's imports, newest first, each linking to its review page with its status word and start time,
 * so an admin who left an import finds it again from the test. Shown only once the test has an import.
 */
export function ImportsList({ testId }: { testId: string }) {
  const { orgId, org } = useWorkspace();
  const imports = useQuery({
    queryKey: qk.orgList(orgId, 'imports', { testId }),
    queryFn: () => api<ImportList>(`/v1/imports?testId=${encodeURIComponent(testId)}`),
  });
  const items = imports.data?.items ?? [];
  if (!items.length) return null;
  const zone = org?.timezone ?? 'Asia/Kolkata';
  return (
    <section aria-labelledby="imports-heading" className="flex flex-col gap-2">
      <h2 id="imports-heading" className="text-heading-3 font-bold">
        {t('imports.list')}
      </h2>
      <ul
        aria-labelledby="imports-heading"
        className="divide-y divide-rule rounded-panel border border-rule bg-surface"
      >
        {items.map((job) => (
          <li key={job.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1">
            <Link
              href={importReviewUrl(job.id)}
              className="inline-flex min-h-11 min-w-0 items-center font-bold break-all text-ballpoint underline"
            >
              {job.filename}
            </Link>
            <span>{t(statusWordKey(job.status, job.pendingCount))}</span>
            <span className="text-graphite">
              {t('imports.startedAt', { when: formatStarted(job.createdAt, zone) })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
