'use client';

import { approvalChecklist, type Question, type TestDetail } from '@mitaoe/shared';
import { Button, InlineMessage, notify } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
import { useId } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';

/**
 * Q-14, DECISIONS Q15: the approval checklist, worked out in the browser with the same shared rules the server runs
 * again on Approve test. Each item says Passed or Failed in words and with an icon (UI-02).
 */
export function ApprovalChecklist({ test, questions }: { test: TestDetail; questions: Question[] }) {
  const { orgId, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const headingId = useId();
  const checklist = approvalChecklist({ test, questions, settings: test.effective });
  const approve = useMutation({
    mutationFn: () =>
      api<{ status: 'approved'; totalMarks: number }>(`/v1/tests/${encodeURIComponent(test.id)}/approve`, {
        method: 'POST',
        body: {},
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
      notify.success(t('preview.approved'));
    },
  });
  const canApprove = test.status === 'draft' || test.status === 'in_review';
  const refused = approve.error instanceof ApiError && approve.error.code === 'CHECKLIST_FAILED';

  return (
    <section aria-labelledby={headingId} className="flex max-w-measure flex-col items-start gap-3">
      <h2 id={headingId} className="text-heading-2 font-bold">
        {t('preview.checklist')}
      </h2>
      <ul role="list" aria-labelledby={headingId} className="flex flex-col gap-2">
        {checklist.items.map((item) => (
          <li key={item.key} className="flex items-start gap-2">
            {item.passed ? (
              <CheckCircle2 aria-hidden size={20} className="mt-0.5 shrink-0 text-tick" />
            ) : (
              <AlertCircle aria-hidden size={20} className="mt-0.5 shrink-0 text-redpen" />
            )}
            <span className={item.passed ? undefined : 'font-bold text-redpen'}>{item.text}</span>
          </li>
        ))}
      </ul>
      {canApprove ? (
        <Button disabled={readOnly || approve.isPending} onClick={() => approve.mutate()}>
          {t('preview.approve')}
        </Button>
      ) : null}
      {refused ? <InlineMessage>{t('preview.refused')}</InlineMessage> : null}
      {approve.isError && !refused ? <InlineMessage>{approve.error.message}</InlineMessage> : null}
    </section>
  );
}
