'use client';

import type { StudentTestPage } from '@mitaoe/shared';
import { InlineMessage, PageHeader, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatCount, formatMarking, formatWindow, formatZonedDay, formatZonedTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';
import { Countdown } from './Countdown';
import { TestNotAvailable } from './TestNotAvailable';
import { testHeading } from './test-heading';

const action = 'inline-flex min-h-12 items-center rounded-control bg-ballpoint px-6 font-bold text-on-ballpoint';

const sectionsLine = (sections: StudentTestPage['sections']) =>
  sections.length === 0
    ? t('studentTest.sectionsNone')
    : t('studentTest.sections', {
        list: sections
          .map((s) =>
            s.questionCount === 1
              ? t('studentTest.sectionOne', { name: s.name })
              : t('studentTest.section', { name: s.name, n: formatCount(s.questionCount) }),
          )
          .join(', '),
      });

/**
 * The test page (spec 7.1 step 1, US-ST-03, UX-11): window, duration, questions, sections, marking and strikes, the
 * last start time and a countdown in the organization's timezone, then the one action that applies now.
 */
export function StudentTestScreen() {
  const id = useSearchParams().get('id') ?? '';
  const { session } = useSession();
  const orgId = session.status === 'ready' ? (session.me.orgId ?? '') : '';
  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'student-test', id),
    queryFn: () => api<StudentTestPage>(`/v1/student/tests/${encodeURIComponent(id)}`),
    enabled: !!orgId && !!id,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });
  if (!id || (query.error instanceof ApiError && query.error.status === 404)) return <TestNotAvailable />;
  if (query.isError) return <InlineMessage>{t('common.loadFailed')}</InlineMessage>;
  const p = query.data;
  if (!p)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-96" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  const tz = p.timezone;
  const details = [
    t('studentTests.window', { window: formatWindow(p.window, tz) }),
    t('studentTests.duration', { n: formatCount(p.durationMin) }),
    t('studentTest.questions', { n: formatCount(p.questionCount) }),
    sectionsLine(p.sections),
    t('studentTest.marking', { marking: formatMarking(p.marking) }),
    t('studentTest.maxStrikes', { n: formatCount(p.maxStrikes) }),
    t('studentTest.lastStart', { time: formatZonedTime(p.lastStartAt, tz) }),
  ];
  const reload = () => void query.refetch();

  return (
    <>
      <PageHeader title={testHeading(p)} subtitle={p.company} />
      <ul aria-label={t('studentTest.details')} className="max-w-measure border-t border-rule">
        {details.map((line) => (
          <li key={line} className="border-b border-rule py-3">
            {line}
          </li>
        ))}
      </ul>
      <div className="mt-8 flex flex-col items-start gap-4">
        {p.state === 'upcoming' ? (
          <>
            <p>
              {t('studentTest.opensAt', {
                time: formatZonedTime(p.window.start, tz),
                date: formatZonedDay(p.window.start, tz),
              })}
            </p>
            <Countdown label={t('studentTests.opensIn')} target={p.window.start} size="display" onElapsed={reload} />
          </>
        ) : null}
        {p.state === 'live' ? (
          <>
            <Countdown label={t('studentTests.lastStartIn')} target={p.lastStartAt} size="display" onElapsed={reload} />
            <Link href={`/exam/preflight/?test=${encodeURIComponent(p.testId)}`} className={action}>
              {t('studentTest.checkDevice')}
            </Link>
          </>
        ) : null}
        {p.state === 'in_progress' && p.attemptId ? (
          <Link href={`/exam/?attempt=${encodeURIComponent(p.attemptId)}`} className={action}>
            {t('studentTest.resume')}
          </Link>
        ) : null}
        {p.state === 'finished' ? <p className="font-bold">{t('studentTest.finished')}</p> : null}
      </div>
    </>
  );
}
