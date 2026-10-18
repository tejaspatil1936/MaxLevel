'use client';

import type { CompletedTest, StudentDashboard as Dashboard, StudentTestSummary } from '@mitaoe/shared';
import { EmptyState, InlineMessage, PageHeader, Skeleton, StatusPill } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useCallback, useId, type ReactNode } from 'react';
import { resultUrl } from '@/features/results/StudentResultScreen';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount, formatWindow } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';
import { Countdown } from './Countdown';
import { studentTestUrl, testHeading } from './test-heading';

const STATUS: Record<CompletedTest['status'], MessageKey> = {
  submitted: 'studentTests.submitted',
  auto_submitted: 'studentTests.autoSubmitted',
  terminated: 'studentTests.terminated',
};

/** The countdown of a live test (to its last start) or an upcoming one (to its window start). */
const countdownOf = (test: StudentTestSummary, live: boolean) =>
  live
    ? { label: t('studentTests.lastStartIn'), target: test.lastStartAt }
    : { label: t('studentTests.opensIn'), target: test.window.start };

/**
 * US-ST-03, UX-11: the next test and its countdown in display numerals, then live, upcoming and completed tests. Every
 * time is in the organization's timezone and counted by the server's clock.
 */
export function StudentDashboard() {
  const { session } = useSession();
  const orgId = session.status === 'ready' ? (session.me.orgId ?? '') : '';
  const query = useQuery({
    queryKey: qk.orgList(orgId, 'student-dashboard'),
    queryFn: () => api<Dashboard>('/v1/student/dashboard'),
    enabled: !!orgId,
  });
  // A test that opens or passes its last start moves group: ask the server again.
  const { refetch: reload } = query;
  const refetch = useCallback(() => void reload(), [reload]);
  const d = query.data;
  const next = d
    ? d.live[0]
      ? { test: d.live[0], live: true }
      : d.upcoming[0] && { test: d.upcoming[0], live: false }
    : null;

  return (
    <>
      <PageHeader title={t('student.title')} />
      {query.isError ? <InlineMessage>{t('common.loadFailed')}</InlineMessage> : null}
      {!d ? (
        query.isError ? null : (
          <div role="status" aria-busy="true" aria-label={t('app.loading')}>
            <Skeleton className="h-40 w-full" />
            <Skeleton className="mt-6 h-24 w-full" />
          </div>
        )
      ) : d.live.length + d.upcoming.length + d.completed.length === 0 ? (
        <EmptyState
          message={t('studentTests.empty')}
          action={
            <Link href="/profile/" className="inline-flex min-h-11 items-center font-bold text-ballpoint underline">
              {t('studentTests.reviewProfile')}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-10">
          {next ? <NextTest test={next.test} live={next.live} timezone={d.timezone} onElapsed={refetch} /> : null}
          <Group title={t('studentTests.live')} items={d.live}>
            {(test) => <OpenItem test={test} live timezone={d.timezone} onElapsed={refetch} />}
          </Group>
          <Group title={t('studentTests.upcoming')} items={d.upcoming}>
            {(test) => <OpenItem test={test} live={false} timezone={d.timezone} onElapsed={refetch} />}
          </Group>
          <Group title={t('studentTests.completed')} items={d.completed}>
            {(test) => (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Link
                  href={resultUrl(test.attemptId)}
                  className="inline-flex min-h-11 items-center text-heading-2 font-bold text-ballpoint underline"
                >
                  {testHeading(test)}
                </Link>
                <StatusPill tone={test.status === 'terminated' ? 'danger' : 'success'}>
                  {t(STATUS[test.status])}
                </StatusPill>
              </div>
            )}
          </Group>
        </div>
      )}
    </>
  );
}

function NextTest({
  test,
  live,
  timezone,
  onElapsed,
}: {
  test: StudentTestSummary;
  live: boolean;
  timezone: string;
  onElapsed: () => void;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="border-y-2 border-ink py-6">
      <h2 id={id} className="text-body-small font-bold text-graphite">
        {t('studentTests.nextTest')}
      </h2>
      <Link
        href={studentTestUrl(test.testId)}
        className="mt-2 inline-flex min-h-11 items-center font-display text-heading-1 font-bold text-ballpoint underline"
      >
        {testHeading(test)}
      </Link>
      <p className="mt-1 text-graphite">{formatWindow(test.window, timezone)}</p>
      <div className="mt-4">
        <Countdown {...countdownOf(test, live)} size="display" onElapsed={onElapsed} />
      </div>
    </section>
  );
}

function Group<T extends { testId: string }>({
  title,
  items,
  children,
}: {
  title: string;
  items: T[];
  children: (item: T) => ReactNode;
}) {
  const id = useId();
  if (items.length === 0) return null;
  return (
    <section>
      <h2 id={id} className="font-display text-heading-1 font-bold">
        {title}
      </h2>
      <ul aria-labelledby={id} className="mt-3 border-t border-rule">
        {items.map((item) => (
          <li key={item.testId} className="border-b border-rule py-4">
            {children(item)}
          </li>
        ))}
      </ul>
    </section>
  );
}

function OpenItem({
  test,
  live,
  timezone,
  onElapsed,
}: {
  test: StudentTestSummary;
  live: boolean;
  timezone: string;
  onElapsed: () => void;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link
          href={studentTestUrl(test.testId)}
          className="inline-flex min-h-11 items-center text-heading-2 font-bold text-ballpoint underline"
        >
          {testHeading(test)}
        </Link>
        {test.company ? <p className="font-bold">{test.company}</p> : null}
        <p className="mt-1">{t('studentTests.window', { window: formatWindow(test.window, timezone) })}</p>
        <p>{t('studentTests.duration', { n: formatCount(test.durationMin) })}</p>
      </div>
      {/* An attempt in progress stays listed after the last start, so there is nothing to wait for. */}
      <Countdown {...countdownOf(test, live)} onElapsed={test.attemptId ? undefined : onElapsed} />
    </div>
  );
}
