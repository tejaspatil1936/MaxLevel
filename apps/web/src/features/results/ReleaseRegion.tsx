'use client';

import type { ReleaseResponse, TestReleaseSummary, WithdrawResponse } from '@mitaoe/shared';
import { Button, ConfirmDialog, InlineMessage, notify } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { formatZonedTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';

const STATE: Record<TestReleaseSummary['state'], MessageKey> = {
  released: 'results.state.released',
  pending: 'results.state.manual',
  withdrawn: 'results.state.withdrawn',
  never: 'results.state.never',
};

/**
 * The `Result release` region (RES-01, RES-05, US-AD-10): the release state in words, Release results unless the
 * results are released or never shared (blocked with its reason in the SER-09 case), and Withdraw results while they
 * are released. Both ask for confirmation and announce the outcome.
 */
export function ReleaseRegion({ summary }: { summary: TestReleaseSummary }) {
  const { orgId, org } = useWorkspace();
  const qc = useQueryClient();
  const headingId = useId();
  const blockedId = useId();
  const [confirm, setConfirm] = useState<'release' | 'withdraw' | null>(null);
  // `isPending` only disables the confirm button after a render, so a double click would send twice without this.
  const sending = useRef(false);
  const zone = org?.timezone ?? 'Asia/Kolkata';
  const at = (ms: number | null) => (ms === null ? '' : formatZonedTime(ms, zone));

  const action = useMutation({
    mutationFn: (kind: 'release' | 'withdraw') =>
      api<ReleaseResponse | WithdrawResponse>(
        `/v1/tests/${encodeURIComponent(summary.testId)}/${kind === 'release' ? 'release' : 'withdraw-results'}`,
        { method: 'POST', body: {} },
      ),
    onSuccess: async (_res, kind) => {
      await qc.invalidateQueries({ queryKey: qk.orgItem(orgId, 'test-release', summary.testId) });
      void qc.invalidateQueries({ queryKey: qk.orgList(orgId, 'results') });
      setConfirm(null);
      notify.success(t(kind === 'release' ? 'results.releasedNotice' : 'results.withdrawnNotice'));
    },
    // Here rather than on `mutate`, so it also runs when the dialog is closed (and the mutation reset) mid-request.
    onSettled: () => {
      sending.current = false;
    },
  });

  const state =
    summary.state === 'pending' && summary.resultRelease === 'after_close' && summary.windowEnd !== null
      ? t('results.state.afterClose', { time: at(summary.windowEnd) })
      : t(STATE[summary.state]);
  const canRelease = summary.state !== 'released' && summary.resultRelease !== 'never';
  const blocked = summary.refusal === 'FULL_REVIEW_BEFORE_CLOSE';

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col items-start gap-3 rounded-panel border border-rule p-5"
    >
      <h2 id={headingId} className="text-heading-2 font-bold">
        {t('results.release')}
      </h2>
      <p>{state}</p>
      {canRelease ? (
        <>
          <Button
            aria-disabled={blocked || undefined}
            aria-describedby={blocked ? blockedId : undefined}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-60"
            onClick={() => !blocked && setConfirm('release')}
          >
            {t('results.releaseAction')}
          </Button>
          {blocked ? (
            <p id={blockedId} className="text-graphite">
              {t('results.fullReviewBlocked', { time: at(summary.windowEnd) })}
            </p>
          ) : null}
        </>
      ) : null}
      {summary.state === 'released' ? (
        <Button variant="secondary" onClick={() => setConfirm('withdraw')}>
          {t('results.withdrawAction')}
        </Button>
      ) : null}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirm(null);
            action.reset();
          }
        }}
        title={t(confirm === 'withdraw' ? 'results.withdrawTitle' : 'results.releaseTitle')}
        description={t(confirm === 'withdraw' ? 'results.withdrawBody' : 'results.releaseBody')}
        cancelLabel={t('common.cancel')}
        confirmLabel={t(confirm === 'withdraw' ? 'results.withdrawAction' : 'results.releaseAction')}
        destructive={confirm === 'withdraw'}
        confirmDisabled={action.isPending}
        onConfirm={() => {
          if (!confirm || sending.current) return;
          sending.current = true;
          action.mutate(confirm);
        }}
      >
        {action.isError ? <InlineMessage>{action.error.message}</InlineMessage> : null}
      </ConfirmDialog>
    </section>
  );
}
