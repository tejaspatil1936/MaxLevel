'use client';

import type { Series, TestDetail } from '@mitaoe/shared';
import { Button, InlineMessage, notify, PageHeader, Skeleton, Tabs } from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatDay, formatWindow } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { seriesUrl } from '../series/SeriesList';
import { MarkingTab } from '../marking/MarkingTab';
import { QuestionsTab } from '../questions/QuestionsTab';
import { SectionsTab } from '../sections/SectionsTab';
import { SeriesNotFound } from '../series/SeriesNotFound';
import { PreviewTab } from './PreviewTab';
import { TestDetailsDialog } from './TestDetailsDialog';
import { TestEligibility } from './TestEligibility';
import { TestSettings } from './TestSettings';
import { TestStatus } from './TestStatus';
import { testHeading } from './test-view';

/** The editor's tabs; each later part of authoring fills its panel. */
const TABS: Array<{ value: string; label: MessageKey }> = [
  { value: 'questions', label: 'tests.tab.questions' },
  { value: 'sections', label: 'tests.tab.sections' },
  { value: 'marking', label: 'tests.tab.marking' },
  { value: 'settings', label: 'tests.tab.settings' },
  { value: 'eligibility', label: 'tests.tab.eligibility' },
  { value: 'preview', label: 'tests.tab.preview' },
];

/** /admin/tests/edit/?id=… (WEB-02). */
export function TestEditor() {
  const { orgId } = useWorkspace();
  const id = useSearchParams().get('id') ?? '';
  const test = useQuery({
    queryKey: qk.orgItem(orgId, 'tests', id),
    queryFn: () => api<TestDetail>(`/v1/tests/${encodeURIComponent(id)}`),
    enabled: !!id,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
  });
  if (!id || (test.error instanceof ApiError && test.error.status === 404)) return <SeriesNotFound kind="test" />;
  if (test.isError) return <InlineMessage>{t('common.loadFailed')}</InlineMessage>;
  if (!test.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  return <EditorPage test={test.data} />;
}

/** TST-01, TST-02, TST-07: the test's heading with its day label, its schedule in the org timezone and its status. */
function EditorPage({ test }: { test: TestDetail }) {
  const { orgId, org, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState('questions');
  const series = useQuery({
    queryKey: qk.orgItem(orgId, 'series', test.seriesId),
    queryFn: () => api<Series>(`/v1/series/${encodeURIComponent(test.seriesId)}`),
  });
  // Q14: an approved test moves to scheduled; the server refuses anything else.
  const publish = useMutation({
    mutationFn: () => api<{ status: string }>(`/v1/tests/${encodeURIComponent(test.id)}/publish`, { method: 'POST' }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
      notify.success(t('tests.published'));
    },
  });
  const window = test.effective.window;
  const when = window ? formatWindow(window, org?.timezone ?? 'Asia/Kolkata') : formatDay(test.scheduledDate);
  const canPublish = test.status === 'approved' && !readOnly;
  // Remounted when the test or its series is saved, so each tab starts from the stored values.
  const stamp = `${test.updatedAt}:${series.data?.updatedAt}`;
  const loading = <Skeleton className="h-64 w-full" />;
  const panel = (value: string) => {
    if (value === 'questions') return <QuestionsTab test={test} />;
    if (value === 'sections') return <SectionsTab test={test} />;
    if (value === 'marking') return series.data ? <MarkingTab key={stamp} test={test} series={series.data} /> : loading;
    if (value === 'settings')
      return series.data ? <TestSettings key={stamp} test={test} series={series.data} /> : loading;
    if (value === 'eligibility')
      return series.data ? <TestEligibility key={stamp} test={test} series={series.data} /> : loading;
    if (value === 'preview') return <PreviewTab test={test} onGoToQuestions={() => setTab('questions')} />;
    return null;
  };

  return (
    <>
      {series.data ? (
        <Link
          href={seriesUrl(series.data.id)}
          className="mb-2 inline-flex min-h-11 items-center font-bold text-ballpoint underline"
        >
          {t('tests.backToSeries', { title: series.data.title })}
        </Link>
      ) : null}
      <PageHeader
        title={testHeading(test)}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span>{t('tests.scheduled', { when })}</span>
            <span data-testid="test-status">
              <TestStatus status={test.status} />
            </span>
          </span>
        }
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(true)} disabled={readOnly || !series.data}>
              {t('tests.editDetails')}
            </Button>
            <Button
              disabled={!canPublish || publish.isPending}
              aria-describedby={canPublish ? undefined : 'publish-hint'}
              onClick={() => publish.mutate()}
            >
              {t('tests.publish')}
            </Button>
          </>
        }
      />
      {canPublish ? null : (
        <p id="publish-hint" className="-mt-4 mb-4 text-right text-body-small text-graphite">
          {t('tests.publishHint')}
        </p>
      )}
      {publish.isError ? <InlineMessage>{publish.error.message}</InlineMessage> : null}
      <Tabs
        value={tab}
        onValueChange={setTab}
        label={t('tests.tabs')}
        tabs={TABS.map((x) => ({
          value: x.value,
          label: t(x.label),
          content: panel(x.value) ?? <p className="text-graphite">{t('tests.tabPending')}</p>,
        }))}
      />
      {editing && series.data ? (
        <TestDetailsDialog series={series.data} test={test} onClose={() => setEditing(false)} />
      ) : null}
    </>
  );
}
