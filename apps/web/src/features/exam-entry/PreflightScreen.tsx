'use client';

import type { ExamEntry } from '@mitaoe/shared';
import { Button, cx, InlineMessage, PageHeader, Skeleton } from '@mitaoe/ui';
import { CircleCheck, CircleX, LoaderCircle } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { countFaces, loadFaceDetector } from '@/features/proctoring/face-detector';
import { TestNotAvailable } from '@/features/student/TestNotAvailable';
import { testHeading } from '@/features/student/test-heading';
import { useStudentTest } from '@/features/student/use-student-test';
import { t, type MessageKey } from '@/i18n';
import { api, serverClockOffset } from '@/lib/api';
import { formatCount } from '@/lib/format';
import {
  browserSupported,
  checksFor,
  clockCheck,
  MIN_SCREEN_WIDTH,
  rememberChecksPassed,
  type CheckId,
  type CheckStatus,
} from './device-checks';
import { primaryLink, rulesUrl } from './links';

interface Result {
  status: Exclude<CheckStatus, 'checking'>;
  detail?: string;
}
type Results = Partial<Record<CheckId, Result>>;

const STATUS = {
  checking: { Icon: LoaderCircle, cls: 'text-graphite', word: 'preflight.status.checking' },
  passed: { Icon: CircleCheck, cls: 'text-tick', word: 'preflight.status.passed' },
  failed: { Icon: CircleX, cls: 'text-redpen', word: 'preflight.status.failed' },
} as const satisfies Record<CheckStatus, { word: MessageKey; [k: string]: unknown }>;

/**
 * /exam/preflight/?test=<testId> (EX-01, US-ST-04, spec 7.1 step 2): each check the test needs, with its status in a
 * word and an icon, its detail once passed or its fix line once failed. The face detector loaded here stays loaded for
 * the exam screen (PERF-05).
 */
export function PreflightScreen() {
  const testId = useSearchParams().get('test') ?? '';
  const { query, notFound } = useStudentTest(testId);
  if (notFound) return <TestNotAvailable />;
  if (query.isError) return <InlineMessage>{t('preflight.loadFailed')}</InlineMessage>;
  if (!query.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-96" />
        <Skeleton className="mt-6 h-80 w-full" />
      </div>
    );
  return <DeviceChecks testId={testId} heading={testHeading(query.data)} exam={query.data.exam} />;
}

/** Resolves once the video has a frame to show and analyse. */
function firstFrame(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return Promise.resolve();
  return new Promise((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }));
}

function DeviceChecks({ testId, heading, exam }: { testId: string; heading: string; exam: ExamEntry }) {
  const ids = useMemo(() => checksFor(exam), [exam]);
  const [results, setResults] = useState<Results>({});
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  // Each run of the checks gets a number; results of an older run, or after leaving the page, are dropped.
  const runs = useRef({ latest: 0 });

  const stopCamera = useCallback(() => {
    for (const track of stream.current?.getTracks() ?? []) track.stop();
    stream.current = null;
  }, []);

  const run = useCallback(async () => {
    const id = ++runs.current.latest;
    const set = (check: CheckId, passed: boolean, detail?: string) => {
      if (runs.current.latest === id)
        setResults((r) => ({ ...r, [check]: passed ? { status: 'passed', detail } : { status: 'failed' } }));
    };

    const network = async () => {
      const started = performance.now();
      try {
        await api('/health');
      } catch {
        set('connection', false);
        set('clock', false);
        return;
      }
      set(
        'connection',
        true,
        t('preflight.detail.connection', { n: formatCount(Math.round(performance.now() - started)) }),
      );
      const clock = clockCheck(serverClockOffset());
      set('clock', clock.passed, t('preflight.detail.clock', { n: formatCount(clock.seconds) }));
    };

    const camera = async () => {
      // The detector loads alongside the camera, and loads even without one, so the exam never fetches it (PERF-05).
      const detector = loadFaceDetector();
      detector.catch(() => undefined);
      const el = video.current;
      let cameraOn = false;
      try {
        stopCamera();
        stream.current = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (!el || runs.current.latest !== id) return stopCamera();
        el.srcObject = stream.current;
        await el.play();
        await firstFrame(el);
        cameraOn = true;
      } catch {
        // NotFoundError, NotAllowedError, or no camera API at all.
      }
      set('camera', cameraOn);
      try {
        const d = await detector;
        if (!cameraOn || !el) throw new Error('No camera frame to analyse');
        countFaces(d, el);
        set('face', true);
      } catch {
        set('face', false);
      }
    };

    const width = window.innerWidth;
    set('screen', width >= MIN_SCREEN_WIDTH, t('preflight.detail.screen', { n: formatCount(width) }));
    if (exam.fullscreenRequired) set('fullscreen', document.fullscreenEnabled);
    set('browser', browserSupported(navigator.userAgent));
    await Promise.all([network(), exam.cameraRequired ? camera() : undefined]);
  }, [exam, stopCamera]);

  useEffect(() => {
    const counter = runs.current;
    void run();
    return () => {
      counter.latest++;
      stopCamera();
    };
  }, [run, stopCamera]);

  const allPassed = ids.every((id) => results[id]?.status === 'passed');
  useEffect(() => rememberChecksPassed(testId, allPassed), [testId, allPassed]);

  const again = () => {
    setResults({});
    void run();
  };

  return (
    <>
      <PageHeader
        title={t('preflight.title')}
        subtitle={heading}
        actions={
          <>
            <Button variant="secondary" onClick={again}>
              {t('preflight.checkAgain')}
            </Button>
            {allPassed ? (
              <Link href={rulesUrl(testId)} className={primaryLink}>
                {t('preflight.continue')}
              </Link>
            ) : (
              <Button aria-disabled="true" className="cursor-not-allowed opacity-60">
                {t('preflight.continue')}
              </Button>
            )}
          </>
        }
      />
      <p className="max-w-measure">{t('preflight.lead')}</p>
      <ul aria-label={t('preflight.checks')} className="mt-6 max-w-measure border-t border-rule">
        {ids.map((id) => {
          const result = results[id];
          const status = STATUS[result?.status ?? 'checking'];
          const text = result?.status === 'failed' ? t(`preflight.fix.${id}`) : result?.detail;
          return (
            <li key={id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-rule py-3">
              <span className="min-w-40 font-bold">{t(`preflight.check.${id}`)}</span>{' '}
              <span className={cx('inline-flex items-center gap-1 font-bold', status.cls)}>
                <status.Icon aria-hidden size={20} className={result ? undefined : 'motion-safe:animate-spin'} />
                {t(status.word)}
              </span>
              {text ? (
                <>
                  {' '}
                  <span className={cx('basis-full', result?.status === 'failed' ? 'text-ink' : 'text-graphite')}>
                    {text}
                  </span>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
      {exam.cameraRequired ? (
        <video
          ref={video}
          muted
          playsInline
          aria-label={t('preflight.cameraView')}
          className="mt-6 aspect-video w-72 -scale-x-100 rounded-panel border border-rule bg-surface-sunken object-cover"
        />
      ) : null}
    </>
  );
}
