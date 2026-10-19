'use client';

import type { ImportJobView, TestDetail } from '@mitaoe/shared';
import { Button, EmptyState, InlineMessage, PageHeader, Skeleton, StatusPill, type Tone } from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { FileImportDialog } from '../questions/FileImportDialog';
import { useQuestions } from '../questions/useQuestions';
import { SeriesNotFound } from '../series/SeriesNotFound';
import { testHeading, testUrl } from '../tests/test-view';
import { DraftActions } from './DraftActions';
import { DraftArticle, DraftBody } from './DraftArticle';
import { DraftEditForm } from './DraftEditForm';
import { useShortcutList } from '../../shell/Shortcuts';
import { isRunning, JobFailed, JobProgress } from './JobProgress';
import { nextAnnouncement, type Announced } from './job-announcement';
import { REVIEW_KEYS, reviewKeyHandler } from './review-keys';
import { SourcePage } from './SourcePage';
import { DRAFT_GROUPS, displayOrder, draftGroup, statusWordKey, summaryCounts } from './review-order';
import { importJobPath, useDraftReview } from './useDraftReview';

/** The job view, polled every 2 seconds while the worker reads the file (IMP-04: no reload needed). */
export function useImportJob(id: string) {
  const { orgId } = useWorkspace();
  return useQuery({
    queryKey: qk.orgItem(orgId, 'imports', id),
    queryFn: () => api<ImportJobView>(importJobPath(id)),
    enabled: !!id,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2,
    refetchInterval: (q) => (q.state.data && !isRunning(q.state.data.status) ? false : 2000),
  });
}

/** /admin/imports/review/?id=<jobId> (WEB-02). */
export function ImportReview() {
  const { orgId } = useWorkspace();
  const id = useSearchParams().get('id') ?? '';
  const job = useImportJob(id);
  const testId = job.data?.testId ?? '';
  const test = useQuery({
    queryKey: qk.orgItem(orgId, 'tests', testId),
    queryFn: () => api<TestDetail>(`/v1/tests/${encodeURIComponent(testId)}`),
    enabled: !!testId,
  });
  if (!id || (job.error instanceof ApiError && job.error.status === 404)) return <SeriesNotFound kind="import" />;
  if (job.isError || test.isError) return <InlineMessage>{t('common.loadFailed')}</InlineMessage>;
  // The heading shows with the job, its test and the test's questions, never before them.
  if (!job.data || !test.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  return <ReviewPage job={job.data} test={test.data} />;
}

/** The text of the page's polite status region (WCAG 4.1.3), updated as the polled job view changes. */
function useJobAnnouncement(job: ImportJobView, timeZone: string): string {
  const [said, setSaid] = useState<{ last: Announced | null; text: string }>({ last: null, text: '' });
  const next = nextAnnouncement(said.last, job, timeZone);
  // nextAnnouncement keeps `last` as it is when nothing new is to be said, so this settles after one update.
  if (next.last !== said.last) setSaid({ last: next.last, text: next.text ?? said.text });
  return next.text ?? said.text;
}

const TONES: Partial<Record<ImportJobView['status'], Tone>> = { failed: 'danger', ready: 'info', retrying: 'muted' };

function ReviewPage({ job, test }: { job: ImportJobView; test: TestDetail }) {
  const { orgId, org, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const questions = useQuestions(test.id);
  const review = useDraftReview(job);
  useShortcutList('imports.shortcuts', REVIEW_KEYS);
  const [importing, setImporting] = useState(false);
  const zone = org?.timezone ?? 'Asia/Kolkata';
  const announcement = useJobAnnouncement(job, zone);
  const drafts = job.drafts;
  const counts = summaryCounts(drafts);
  const pending = drafts.filter((d) => d.status === 'pending').length;
  const positions = new Map(questions.data?.items.map((q, i) => [q.id, i + 1]) ?? []);

  const retry = useMutation({
    mutationFn: () => api(`${importJobPath(job.id)}/retry`, { method: 'POST', body: {} }),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.orgItem(orgId, 'imports', job.id) }),
  });

  if (!questions.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-80" />
      </div>
    );
  const ready = job.status === 'ready';
  return (
    <>
      <Link
        href={testUrl(test.id)}
        className="mb-2 inline-flex min-h-11 items-center font-bold text-ballpoint underline"
      >
        {t('imports.backTo', { test: testHeading(test) })}
      </Link>
      <PageHeader
        title={t('imports.reviewTitle', { filename: job.filename })}
        subtitle={
          <span data-testid="import-status">
            <StatusPill tone={TONES[job.status] ?? 'neutral'}>{t(statusWordKey(job.status, pending))}</StatusPill>
          </span>
        }
        actions={
          ready && drafts.length ? (
            <Button disabled={readOnly || counts.ready === 0 || review.busy} onClick={review.approveAll}>
              {t('imports.approveAll')}
            </Button>
          ) : null
        }
      />
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
      {isRunning(job.status) ? <JobProgress job={job} timeZone={zone} /> : null}
      <JobFailed job={job} retrying={retry.isPending} onRetry={() => retry.mutate()} />
      {retry.isError ? <InlineMessage>{retry.error.message}</InlineMessage> : null}
      {ready ? (
        <ul aria-label={t('imports.summary')} className="mb-6 flex flex-wrap gap-x-6 gap-y-2">
          <li>{t('imports.summary.found', { n: formatCount(counts.found) })}</li>
          {DRAFT_GROUPS.map((g) => (
            <li key={g}>{t(`imports.summary.${g}`, { n: formatCount(counts[g]) })}</li>
          ))}
        </ul>
      ) : null}
      {ready && drafts.length === 0 ? (
        <EmptyState
          message={t('imports.empty')}
          action={<Button onClick={() => setImporting(true)}>{t('imports.importAnother')}</Button>}
        />
      ) : null}
      {drafts.length ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* The review keys act only from inside the groups (IMP-13). */}
          <div className="flex min-w-0 flex-col gap-8" onKeyDown={reviewKeyHandler(displayOrder(drafts), review)}>
            {DRAFT_GROUPS.map((g) => {
              const inGroup = displayOrder(drafts).filter((d) => draftGroup(d) === g);
              if (!inGroup.length) return null;
              return (
                <section key={g} aria-labelledby={`import-group-${g}`} className="flex flex-col gap-4">
                  <h2 id={`import-group-${g}`} className="text-heading-2 font-bold">
                    {t(`imports.group.${g}`)}
                  </h2>
                  {inGroup.map((d) => (
                    <DraftArticle
                      key={d.id}
                      draft={d}
                      current={d.id === review.current}
                      onSelect={() => review.select(d.id)}
                    >
                      {review.editing === d.id ? (
                        <DraftEditForm
                          jobId={job.id}
                          draft={d}
                          imageUrls={job.imageUrls ?? {}}
                          onSaved={review.saved}
                          onCancel={review.cancelEdit}
                        />
                      ) : (
                        <>
                          <DraftBody job={job} draft={d} imageUrls={job.imageUrls ?? {}} />
                          {d.status === 'approved' && d.questionId && positions.has(d.questionId) ? (
                            <p>{t('imports.addedAs', { m: formatCount(positions.get(d.questionId)!) })}</p>
                          ) : null}
                          <DraftActions
                            draft={d}
                            readOnly={readOnly}
                            onApprove={() => review.approveOne(d)}
                            onEdit={() => review.startEdit(d)}
                            onDiscard={() => review.discardOne(d)}
                          />
                        </>
                      )}
                    </DraftArticle>
                  ))}
                </section>
              );
            })}
          </div>
          <SourcePage job={job} draft={drafts.find((d) => d.id === review.current)} />
        </div>
      ) : null}
      {importing ? <FileImportDialog testId={test.id} onClose={() => setImporting(false)} /> : null}
    </>
  );
}
