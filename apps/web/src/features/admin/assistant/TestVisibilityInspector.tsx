'use client';

import type { DiagnosticReport } from '@mitaoe/shared';
import { Button, Skeleton } from '@mitaoe/ui';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';

export function TestVisibilityInspector({ testId }: { testId: string }) {
  const { orgId } = useWorkspace();
  const [expanded, setExpanded] = useState(false);

  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'diagnose-test', testId),
    queryFn: () => api<DiagnosticReport>(`/v1/admin/diagnose/tests/${encodeURIComponent(testId)}`),
    enabled: Boolean(orgId && testId),
  });

  if (query.isLoading) {
    return (
      <div className="rounded-panel border border-rule bg-surface p-4 shadow-sm" aria-busy="true">
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-6 rounded-full" />
          <Skeleton className="h-5 w-48" />
        </div>
      </div>
    );
  }

  if (query.isError || !query.data) {
    return null;
  }

  const report = query.data;
  const isVisible = report.isVisibleToStudents;

  return (
    <section
      aria-label={t('assistant.diagnoseTitle')}
      className={`rounded-panel border-2 p-4 shadow-sm transition-all ${
        isVisible ? 'border-tick/40 bg-surface' : 'border-redpen/40 bg-surface'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control ${
              isVisible ? 'bg-tick/15 text-tick' : 'bg-redpen/15 text-redpen'
            }`}
          >
            {isVisible ? <CheckCircle2 size={20} aria-hidden="true" /> : <AlertCircle size={20} aria-hidden="true" />}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-heading-3 font-bold text-ink">{t('assistant.diagnoseTitle')}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${
                  isVisible ? 'bg-tick/15 text-tick' : 'bg-redpen/15 text-redpen'
                }`}
              >
                {isVisible ? t('assistant.visible') : t('assistant.hidden')}
              </span>
            </div>
            <p className="mt-0.5 text-body-small text-graphite">{report.summary}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setExpanded(!expanded)} className="gap-1.5 font-bold">
            <span>{expanded ? t('common.close') : t('common.moreActions')}</span>
            {expanded ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
          </Button>
        </div>
      </div>

      {/* Expanded detailed breakdown */}
      {expanded ? (
        <div className="mt-4 border-t border-rule pt-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {report.checks.map((c) => (
              <div
                key={c.name}
                className="flex items-center justify-between rounded-control border border-rule bg-surface-sunken p-2.5 text-body-small"
              >
                <span className="font-bold text-ink">{c.name}</span>
                <span className="flex items-center gap-1.5 text-caption">
                  {c.status === 'passed' ? (
                    <>
                      <CheckCircle2 size={14} className="text-tick shrink-0" aria-hidden="true" />
                      <span className="text-tick font-bold">{c.detail}</span>
                    </>
                  ) : c.status === 'warning' ? (
                    <>
                      <AlertTriangle size={14} className="text-highlighter shrink-0" aria-hidden="true" />
                      <span className="text-graphite">{c.detail}</span>
                    </>
                  ) : (
                    <>
                      <AlertCircle size={14} className="text-redpen shrink-0" aria-hidden="true" />
                      <span className="text-redpen font-bold">{c.detail}</span>
                    </>
                  )}
                </span>
              </div>
            ))}
          </div>

          {/* Actionable issues list */}
          {report.issues.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2">
              {report.issues.map((issue) => (
                <div
                  key={issue.code}
                  className={`flex flex-col gap-1.5 rounded-control border p-3 ${
                    issue.severity === 'critical' ? 'border-redpen/30 bg-redpen-wash/20' : 'border-rule bg-sheet'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-ink">{issue.title}</span>
                    <span
                      className={`text-[11px] font-bold uppercase tracking-wider ${
                        issue.severity === 'critical' ? 'text-redpen' : 'text-graphite'
                      }`}
                    >
                      {issue.severity}
                    </span>
                  </div>
                  <p className="text-body-small text-graphite">{issue.message}</p>
                  <div className="mt-1 flex items-center justify-between border-t border-rule/50 pt-2">
                    <span className="text-caption font-semibold text-graphite">{issue.howToFix}</span>
                    {issue.actionHref && issue.actionLabel ? (
                      <Link
                        href={issue.actionHref}
                        className="inline-flex items-center gap-1 text-caption font-bold text-ballpoint underline"
                      >
                        <span>{issue.actionLabel}</span>
                        <ArrowRight size={12} aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
