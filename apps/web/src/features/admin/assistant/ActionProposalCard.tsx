'use client';

import type { ApplyActionResponse, AssistantActionProposal } from '@mitaoe/shared';
import { Button } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, ShieldCheck, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';

export function ActionProposalCard({
  proposal,
  onApplied,
}: {
  proposal: AssistantActionProposal;
  onApplied?: (res: ApplyActionResponse) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const [result, setResult] = useState<ApplyActionResponse | null>(null);
  const qc = useQueryClient();

  const applyMutation = useMutation({
    mutationFn: () =>
      api<ApplyActionResponse>('/v1/admin/assistant/apply-action', {
        method: 'POST',
        body: { proposal },
      }),
    onSuccess: (res) => {
      setResult(res);
      // Invalidate relevant queries so series / tests lists refresh automatically
      void qc.invalidateQueries();
      onApplied?.(res);
    },
  });

  if (dismissed) {
    return (
      <div className="mt-3 rounded-control border border-rule bg-surface-sunken p-2.5 text-caption text-graphite flex items-center justify-between">
        <span>{t('assistant.proposalDismissed')}</span>
      </div>
    );
  }

  if (result) {
    return (
      <div className="mt-3 rounded-control border-2 border-tick bg-surface p-4 text-ink shadow-sm">
        <div className="flex items-start gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control bg-tick-wash text-tick">
            <CheckCircle2 size={18} aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h4 className="font-bold text-heading-3 text-ink">{t('assistant.proposalSuccess')}</h4>
            <p className="mt-1 text-body-small text-graphite">{result.message}</p>
            {result.editUrl && (
              <div className="mt-3">
                <Link
                  href={result.editUrl}
                  className="inline-flex items-center gap-1.5 rounded-control bg-ballpoint px-3 py-1.5 text-caption font-bold text-on-ballpoint hover:opacity-90 transition-opacity"
                >
                  <span>{t('assistant.proposalOpenEditor')}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="region"
      aria-label={t('assistant.proposalBadge')}
      className="mt-3 rounded-panel border-2 border-ballpoint bg-surface p-4 text-ink shadow-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-rule pb-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-6 items-center gap-1.5 rounded bg-ballpoint-wash px-2 text-[10px] font-bold uppercase tracking-wider text-ballpoint">
            <Sparkles size={12} aria-hidden="true" />
            <span>{t('assistant.proposalBadge')}</span>
          </span>
        </div>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="text-graphite hover:text-ink transition-colors p-1"
          aria-label={t('assistant.proposalDismiss')}
        >
          <X size={14} />
        </button>
      </div>

      {/* Proposal Title & Summary */}
      <div className="mt-3">
        <h3 className="font-display text-heading-3 font-bold text-ink">{proposal.title}</h3>
        <p className="mt-1 text-body-small text-graphite">{proposal.summary}</p>
      </div>

      {/* Diffs / Parameters Grid */}
      {proposal.diffs.length > 0 && (
        <div className="mt-3 rounded-control border border-rule bg-surface-sunken p-2.5">
          <span className="text-[10px] font-bold uppercase tracking-wider text-graphite block mb-1.5">
            {t('assistant.proposalParameters')}
          </span>
          <div className="space-y-1.5 text-body-small">
            {proposal.diffs.map((d) => (
              <div
                key={d.field}
                className="flex items-start justify-between gap-2 border-b border-rule/50 pb-1 last:border-b-0 last:pb-0"
              >
                <span className="text-graphite font-medium text-caption">{d.label}:</span>
                <span className="text-ink font-semibold text-right text-caption">{d.value}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Human-in-the-loop Assessment Integrity Notice */}
      <div className="mt-3 flex items-start gap-2 rounded-control bg-highlighter-wash border border-highlighter/30 p-2.5 text-caption font-medium text-ink">
        <ShieldCheck size={16} className="shrink-0 text-ballpoint mt-0.5" aria-hidden="true" />
        <span>{t('assistant.proposalQuestionWarning')}</span>
      </div>

      {/* Action Buttons */}
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-rule pt-3">
        <Button type="button" variant="secondary" onClick={() => setDismissed(true)} disabled={applyMutation.isPending}>
          {t('assistant.proposalDismiss')}
        </Button>
        <Button
          type="button"
          variant="primary"
          onClick={() => applyMutation.mutate()}
          disabled={applyMutation.isPending}
          className="bg-ballpoint text-on-ballpoint hover:opacity-90"
        >
          {applyMutation.isPending ? t('assistant.proposalApplying') : t('assistant.proposalConfirm')}
        </Button>
      </div>

      {applyMutation.isError ? (
        <div className="mt-2 text-caption text-redpen font-semibold">
          {applyMutation.error instanceof Error ? applyMutation.error.message : t('assistant.error')}
        </div>
      ) : null}
    </div>
  );
}
