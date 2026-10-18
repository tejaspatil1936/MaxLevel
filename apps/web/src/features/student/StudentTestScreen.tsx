'use client';

import { InlineMessage, PageHeader, Skeleton } from '@mitaoe/ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { t } from '@/i18n';
import { formatCount, formatMarking, formatWindow, formatZonedDay, formatZonedTime } from '@/lib/format';
import { Countdown } from './Countdown';
import { TestNotAvailable } from './TestNotAvailable';
import { sectionsLine, testHeading } from './test-heading';
import { useStudentTest } from './use-student-test';

const action = 'inline-flex min-h-12 items-center rounded-control bg-ballpoint px-6 font-bold text-on-ballpoint';

/**
 * The test page (spec 7.1 step 1, US-ST-03, UX-11): window, duration, questions, sections, marking and strikes, the
 * last start time and a countdown in the organization's timezone, then the one action that applies now.
 */
export function StudentTestScreen() {
  const { query, notFound } = useStudentTest(useSearchParams().get('id') ?? '');
  if (notFound) return <TestNotAvailable />;
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
