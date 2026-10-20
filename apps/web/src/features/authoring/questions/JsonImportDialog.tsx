'use client';

import {
  importedToQuestionInput,
  parseQuestionJson,
  questionProblems,
  type QuestionCreate,
  type QuestionList,
} from '@mitaoe/shared';
import { Button, Dialog, FileField, InlineMessage, notify } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { questionsPath } from './useQuestions';

/** Reads an import file in the browser: the legacy format or `mitaoe-questions/1`, as create requests (Q-01). */
async function readQuestionFile(file: File): Promise<QuestionCreate[] | null> {
  try {
    const parsed = parseQuestionJson(JSON.parse(await file.text()));
    return 'error' in parsed ? null : parsed.questions.map(importedToQuestionInput);
  } catch {
    return null;
  }
}

/**
 * Q-01: `Import JSON` checks every question like a written one (DECISIONS Q17) and shows how many are ready before
 * anything is added; the questions are appended in file order with one `question.import` entry.
 */
export function JsonImportDialog({
  testId,
  list,
  onImported,
  onClose,
}: {
  testId: string;
  list: QuestionList;
  onImported: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [questions, setQuestions] = useState<QuestionCreate[] | null>(null);
  const [error, setError] = useState<string>();
  const ready = (() => {
    if (!questions) return 0;
    const seen: Array<{ prompt: string }> = [...list.items];
    return questions.filter((q) => {
      const ok = questionProblems(q, seen).length === 0;
      seen.push(q);
      return ok;
    }).length;
  })();

  const save = useMutation({
    mutationFn: (body: { questions: QuestionCreate[] }) =>
      api<{ count: number }>(`${questionsPath(testId)}/import`, { method: 'POST', body }),
    onSuccess: async ({ count }) => {
      await onImported();
      notify.success(
        count === 1 ? t('questions.imported.one') : t('questions.imported.other', { n: formatCount(count) }),
      );
      onClose();
    },
  });
  const choose = async (file: File | undefined) => {
    setQuestions(null);
    setError(undefined);
    save.reset();
    if (!file) return;
    const read = await readQuestionFile(file);
    if (read) setQuestions(read);
    else setError(t('questions.importInvalid'));
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (questions) save.mutate({ questions });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('questions.importTitle')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <FileField
          label={t('questions.importFile')}
          requiredText={t('common.requiredMark')}
          hint={t('questions.importHint')}
          accept="application/json,.json"
          error={error}
          onChange={(e) => void choose(e.currentTarget.files?.[0])}
        />
        {questions ? (
          <>
            <ul aria-label={t('questions.importSummary')} className="flex flex-col gap-1">
              <li>{t('questions.importFound', { n: formatCount(questions.length) })}</li>
              <li>{t('questions.importReady', { n: formatCount(ready) })}</li>
              <li>{t('questions.importAttention', { n: formatCount(questions.length - ready) })}</li>
            </ul>
            {questions.length > ready ? (
              <p className="text-body-small text-graphite">{t('questions.importAttentionNote')}</p>
            ) : null}
          </>
        ) : null}
        {save.isError ? <InlineMessage>{save.error.message}</InlineMessage> : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {questions ? (
            <Button type="submit" disabled={save.isPending}>
              {t('questions.importSubmit')}
            </Button>
          ) : null}
        </div>
      </form>
    </Dialog>
  );
}
