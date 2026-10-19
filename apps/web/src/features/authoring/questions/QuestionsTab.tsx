'use client';

import type { Question, QuestionList as Listed, TestDetail } from '@mitaoe/shared';
import { Button, ConfirmDialog, EmptyState, InlineMessage, notify, Skeleton } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';
import { FileImportDialog } from './FileImportDialog';
import { JsonImportDialog } from './JsonImportDialog';
import { QuestionEditor } from './QuestionEditor';
import { QuestionList } from './QuestionList';
import { questionsPath, useQuestions, useQuestionsChanged } from './useQuestions';

/** Q-01: the test's questions: add and edit with a live student view, import JSON or a file, reorder and delete. */
export function QuestionsTab({ test }: { test: TestDetail }) {
  const { readOnly } = useWorkspace();
  const qc = useQueryClient();
  const questions = useQuestions(test.id);
  const changed = useQuestionsChanged(test.id);
  const [deleting, setDeleting] = useState<{ question: Question; n: number } | null>(null);
  // `null`: closed; `{}`: adding; `{ question, n }`: editing question n.
  const [editing, setEditing] = useState<{ question?: Question; n?: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [importingFile, setImportingFile] = useState(false);

  // The new order shows at once and is saved straight away (Q-01).
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api(`${questionsPath(test.id)}/order`, { method: 'PUT', body: { ids } }),
    onMutate: (ids) => {
      qc.setQueryData<Listed>(changed.key, (old) => {
        if (!old) return old;
        const byId = new Map(old.items.map((q) => [q.id, q]));
        return { ...old, items: ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])) };
      });
    },
    onSettled: () => changed.refresh(),
  });
  const remove = useMutation({
    mutationFn: (q: Question) => api(`${questionsPath(test.id)}/${encodeURIComponent(q.id)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setDeleting(null);
      notify.success(t('questions.deleted'));
      await changed.refresh();
    },
  });

  if (questions.isError) return <InlineMessage>{t('common.loadFailed')}</InlineMessage>;
  if (!questions.data)
    return (
      <div role="status" aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-40 w-full" />
      </div>
    );
  const items = questions.data.items;
  const add = (
    <Button disabled={readOnly} onClick={() => setEditing({})}>
      {t('questions.add')}
    </Button>
  );
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap justify-end gap-3">
        <Button variant="secondary" disabled={readOnly} onClick={() => setImporting(true)}>
          {t('questions.importJson')}
        </Button>
        <Button variant="secondary" disabled={readOnly} onClick={() => setImportingFile(true)}>
          {t('imports.fromFile')}
        </Button>
        {items.length ? add : null}
      </div>
      {reorder.isError ? (
        <InlineMessage>{t('questions.reorderFailed', { reason: reorder.error.message })}</InlineMessage>
      ) : null}
      {items.length === 0 ? (
        <EmptyState message={t('questions.empty')} action={add} />
      ) : (
        <QuestionList
          questions={items}
          sections={test.sections}
          readOnly={readOnly}
          onReorder={(ids) => reorder.mutate(ids)}
          onEdit={(question, n) => setEditing({ question, n })}
          onDelete={(question, n) => setDeleting({ question, n })}
        />
      )}
      {editing ? (
        <QuestionEditor
          test={test}
          list={questions.data}
          editing={editing.question && editing.n ? { question: editing.question, n: editing.n } : undefined}
          onSaved={() => changed.refresh()}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {importing ? (
        <JsonImportDialog
          testId={test.id}
          list={questions.data}
          onImported={() => changed.refresh()}
          onClose={() => setImporting(false)}
        />
      ) : null}
      {importingFile ? <FileImportDialog testId={test.id} onClose={() => setImportingFile(false)} /> : null}
      {deleting ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={t('questions.deleteTitle', { n: deleting.n })}
          description={t('questions.deleteBody')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('questions.deleteConfirm')}
          destructive
          confirmDisabled={remove.isPending}
          onConfirm={() => remove.mutate(deleting.question)}
        >
          {remove.isError ? <InlineMessage>{remove.error.message}</InlineMessage> : null}
        </ConfirmDialog>
      ) : null}
    </div>
  );
}
