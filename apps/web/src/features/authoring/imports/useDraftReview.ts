'use client';

import type { ImportDraft, ImportJobView } from '@mitaoe/shared';
import { notify } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { useQuestionsChanged } from '../questions/useQuestions';
import { draftArticleId } from './DraftArticle';
import { currentAfter, draftGroup, firstCurrent } from './review-order';

export const importJobPath = (id: string) => `/v1/imports/${encodeURIComponent(id)}`;

/**
 * IMP-11, IMP-12: the current draft and the review actions. Exactly one draft is current: the last one clicked, focused
 * or reached by a key, else the first pending one. After an approve or discard the next pending draft (or the previous
 * one) becomes current and takes focus, once the job view shows the change.
 */
export function useDraftReview(job: ImportJobView) {
  const { orgId, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const questionsChanged = useQuestionsChanged(job.testId);
  const [chosen, setChosen] = useState<string | null>(null);
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const drafts = job.drafts;
  const current = chosen && drafts.some((d) => d.id === chosen) ? chosen : firstCurrent(drafts);
  const jobKey = qk.orgItem(orgId, 'imports', job.id);

  // Focus moves once the article is drawn in its new group (it is a new element there).
  useEffect(() => {
    if (!focusOn) return;
    const el = document.getElementById(draftArticleId(focusOn));
    if (!el) return;
    el.focus();
    el.scrollIntoView({ block: 'nearest' });
    setFocusOn(null);
  }, [focusOn, drafts]);

  /** Makes a draft current and moves focus to it. */
  const goTo = (id: string | null) => {
    if (!id) return;
    setChosen(id);
    setFocusOn(id);
  };

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: jobKey }),
      qc.invalidateQueries({ queryKey: qk.orgList(orgId, 'imports', { testId: job.testId }) }),
      questionsChanged.refresh(),
    ]);
  const failed = async (err: Error) => {
    notify.error(err.message);
    await refresh();
  };

  const approve = useMutation({
    mutationFn: ({ ids }: { ids: string[]; from?: string }) =>
      api<{ questionIds: string[] }>(`${importJobPath(job.id)}/approve`, { method: 'POST', body: { draftIds: ids } }),
    onSuccess: async (res, { from }) => {
      const next = from ? currentAfter(drafts, from) : null;
      await refresh();
      notify.success(
        res.questionIds.length === 1
          ? t('imports.approvedOne')
          : t('imports.approvedMany', { n: formatCount(res.questionIds.length) }),
      );
      const after = qc.getQueryData<ImportJobView>(jobKey)?.drafts ?? [];
      goTo(next ?? (after.find((d) => d.id === current)?.status === 'pending' ? current : firstCurrent(after)));
    },
    onError: failed,
  });

  const discard = useMutation({
    mutationFn: (d: ImportDraft) =>
      api(`${importJobPath(job.id)}/discard`, { method: 'POST', body: { draftIds: [d.id] } }),
    onSuccess: async (_res, d) => {
      const next = currentAfter(drafts, d.id);
      await refresh();
      notify.success(t('imports.discardedOne', { n: formatCount(d.order) }));
      goTo(next);
    },
    onError: failed,
  });

  const busy = approve.isPending || discard.isPending;
  return {
    current,
    /** An archived organization: drafts can be read, never approved, edited or discarded (ORG-07). */
    readOnly,
    select: setChosen,
    goTo,
    refresh,
    busy,
    /** The draft whose inline edit is open (IMP-12); focus returns to its article when it closes. */
    editing,
    startEdit(d: ImportDraft) {
      if (readOnly || d.status !== 'pending') return;
      setChosen(d.id);
      setEditing(d.id);
    },
    async saved(d: ImportDraft) {
      setEditing(null);
      await refresh();
      notify.success(t('imports.saved', { n: formatCount(d.order) }));
      goTo(d.id);
    },
    cancelEdit() {
      const id = editing;
      setEditing(null);
      goTo(id);
    },
    /** Approves one draft; a flagged one is never sent (IMP-10). */
    approveOne(d: ImportDraft) {
      if (readOnly || busy || d.status !== 'pending') return;
      if (d.flags.length) return void notify.info(t('imports.fixBeforeApproving'));
      approve.mutate({ ids: [d.id], from: d.id });
    },
    /** Every pending draft without a flag, in order. */
    approveAll() {
      const ids = drafts.filter((d) => draftGroup(d) === 'ready').map((d) => d.id);
      if (!readOnly && !busy && ids.length) approve.mutate({ ids });
    },
    discardOne(d: ImportDraft) {
      if (!readOnly && !busy && d.status === 'pending') discard.mutate(d);
    },
  };
}
export type DraftReview = ReturnType<typeof useDraftReview>;
