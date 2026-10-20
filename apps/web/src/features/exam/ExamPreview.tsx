'use client';

import type { ExamPreview as ExamPreviewPayload, MeResponse } from '@mitaoe/shared';
import { InlineMessage, Skeleton, Switch } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import { Eye } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import { testHeading, testUrl } from '@/features/authoring/tests/test-view';
import { AccessibilityButton } from '@/features/shell/AccessibilityPanel';
import { RoleGuard } from '@/features/shell/RoleGuard';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { workspaceOrgId } from '@/lib/workspace';
import { examReducer, initialExamState } from './exam-state';
import { ExamScreen } from './ExamScreen';

const linkClass =
  'inline-flex min-h-11 items-center rounded-control border border-rule bg-surface px-4 font-bold text-ballpoint hover:bg-ballpoint-wash';

/**
 * /exam/?preview=<testId> (Q-13, US-AD-08): the real exam screen for an admin, or a super admin in an organization's
 * workspace, with no attempt. Everything stays in memory: no attempt, answer or event request, and no proctoring
 * (no camera, no fullscreen, no strikes). Students are sent to their home by the guard.
 */
export function ExamPreviewRoute() {
  const testId = useSearchParams().get('preview') ?? '';
  return <RoleGuard roles={['admin', 'superAdmin']}>{(me) => <PreviewWorkspace me={me} testId={testId} />}</RoleGuard>;
}

function PreviewWorkspace({ me, testId }: { me: MeResponse; testId: string }) {
  const router = useRouter();
  // A super admin previews inside the organization chosen in the switcher (ORG-12), like any admin page.
  const [orgId] = useState(() => workspaceOrgId(me));
  useEffect(() => {
    if (!orgId) router.replace('/platform/');
  }, [orgId, router]);
  return orgId ? <PreviewLoader orgId={orgId} testId={testId} /> : null;
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="mx-auto flex max-w-student flex-col items-start gap-4 px-4 py-12">
      <h1 className="font-display text-heading-1 font-bold">{t('preview.title')}</h1>
      {children}
    </main>
  );
}

function PreviewLoader({ orgId, testId }: { orgId: string; testId: string }) {
  const preview = useQuery({
    queryKey: qk.orgItem(orgId, 'testPreview', testId),
    queryFn: () => api<ExamPreviewPayload>(`/v1/tests/${encodeURIComponent(testId)}/preview`),
    enabled: !!testId,
    // One draw per opening: never refetched while open (that would redraw), and dropped when the preview closes so
    // the next opening draws afresh.
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  if (!testId || (preview.error instanceof ApiError && preview.error.status === 404))
    return (
      <Notice>
        <InlineMessage>{t('preview.notFound')}</InlineMessage>
        <Link href="/admin/series/" className={linkClass}>
          {t('preview.backToTests')}
        </Link>
      </Notice>
    );
  if (preview.isError)
    return (
      <Notice>
        <InlineMessage>{t('preview.loadFailed')}</InlineMessage>
      </Notice>
    );
  if (!preview.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')} className="mx-auto max-w-admin p-6">
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-96 w-full" />
      </div>
    );
  const exit = (
    <Link href={testUrl(testId)} className={linkClass}>
      {t('preview.exit')}
    </Link>
  );
  if (preview.data.questions.length === 0)
    return (
      <Notice>
        <p>{t('preview.empty')}</p>
        {exit}
      </Notice>
    );
  return <PreviewExam exam={preview.data} exit={exit} />;
}

function PreviewExam({ exam, exit }: { exam: ExamPreviewPayload; exit: ReactNode }) {
  const ids = useMemo(() => exam.questions.map((q) => q.id), [exam]);
  const [state, dispatch] = useReducer(
    useMemo(() => examReducer(ids), [ids]),
    ids,
    initialExamState,
  );
  const [showAnswers, setShowAnswers] = useState(false);
  return (
    <ExamScreen
      exam={exam}
      title={testHeading(exam.test)}
      state={state}
      dispatch={dispatch}
      showAnswers={showAnswers}
      bar={
        <>
          <p className="flex items-center gap-2 text-graphite">
            <Eye aria-hidden size={20} />
            {t('preview.note')}
          </p>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            <Switch label={t('preview.showAnswers')} checked={showAnswers} onCheckedChange={setShowAnswers} />
            <AccessibilityButton inExam />
            {exit}
          </div>
        </>
      }
    />
  );
}
