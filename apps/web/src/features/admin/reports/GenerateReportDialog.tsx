'use client';

import {
  testBoardTitle,
  type Page,
  type ReportRequest,
  type ReportScope,
  type ResultsOverview,
  type Series,
} from '@mitaoe/shared';
import { Button, Checkbox, Dialog, InlineMessage, RadioGroup, SelectField } from '@mitaoe/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';

type Errors = { field?: string; alert?: string };

/**
 * The Generate report dialog (US-AD-15, EXP-07): a published test (`<heading>, <series>`, newest date first) or a
 * series (by title), the optional XLSX and what one report costs. Refusals keep it open: nothing chosen and
 * NO_FINISHED_ATTEMPTS on the select (which takes focus), LIMIT_REACHED as an alert. One request at a time, each with
 * its own Idempotency-Key (API-02).
 */
export function GenerateReportDialog({
  limit,
  onClose,
  onCreated,
}: {
  limit: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { orgId } = useWorkspace();
  const [scope, setScope] = useState<ReportScope>('test');
  const [choice, setChoice] = useState<Record<ReportScope, string>>({ test: '', series: '' });
  const [includeXlsx, setIncludeXlsx] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const select = useRef<HTMLSelectElement>(null);
  const busy = useRef(false);

  const tests = useQuery({
    queryKey: qk.orgList(orgId, 'results'),
    queryFn: () => api<ResultsOverview>('/v1/results'),
  });
  const series = useQuery({
    queryKey: qk.orgList(orgId, 'series'),
    queryFn: () => api<Page<Series>>('/v1/series?limit=200'),
  });
  const testOptions = (tests.data?.tests ?? []).map((x) => ({
    value: x.testId,
    label: t('reports.testOption', { heading: testBoardTitle(x.title, x.dayLabel), series: x.seriesTitle }),
  }));
  const seriesOptions = [...(series.data?.items ?? [])]
    .sort((a, b) => a.title.localeCompare(b.title, 'en') || a.id.localeCompare(b.id))
    .map((s) => ({ value: s.id, label: s.title }));

  const fieldError = (message: string) => {
    setErrors({ field: message });
    select.current?.focus();
  };
  const create = useMutation({
    mutationFn: (body: ReportRequest) =>
      api<{ id: string }>('/v1/reports', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': crypto.randomUUID() },
      }),
    onSuccess: () => onCreated(),
    onError: (e, body) => {
      if (e instanceof ApiError && e.code === 'NO_FINISHED_ATTEMPTS')
        fieldError(t(body.scope === 'test' ? 'reports.noAttemptsTest' : 'reports.noAttemptsSeries'));
      else if (e instanceof ApiError && e.code === 'LIMIT_REACHED')
        setErrors({ alert: t('reports.limitReached', { max: formatCount(Number(e.details.max ?? limit)) }) });
      else setErrors({ alert: e.message });
    },
    onSettled: () => {
      busy.current = false;
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy.current) return;
    const refId = choice[scope];
    if (!refId) return fieldError(t(scope === 'test' ? 'reports.chooseTest' : 'reports.chooseSeries'));
    setErrors({});
    busy.current = true;
    create.mutate({ scope, refId, includeXlsx });
  };
  const pick = (e: { target: { value: string } }) => {
    setChoice((c) => ({ ...c, [scope]: e.target.value }));
    setErrors({});
  };

  return (
    // The list behind keeps polling and announcing status changes, so the page stays readable (A11Y-05 still holds).
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('reports.generate')} pageBehind="readable">
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <RadioGroup
          label={t('reports.reportOn')}
          value={scope}
          onValueChange={(v) => {
            setScope(v);
            setErrors({});
          }}
          options={[
            { value: 'test', label: t('reports.aTest') },
            { value: 'series', label: t('reports.aSeries') },
          ]}
        />
        <SelectField
          key={scope}
          ref={select}
          label={t(scope === 'test' ? 'reports.test' : 'reports.series')}
          requiredText={t('common.requiredMark')}
          value={choice[scope]}
          onChange={pick}
          placeholder=""
          options={scope === 'test' ? testOptions : seriesOptions}
          error={errors.field}
        />
        <Checkbox label={t('reports.xlsx')} checked={includeXlsx} onCheckedChange={setIncludeXlsx} />
        <p className="text-graphite">{t('reports.cost', { limit: formatCount(limit) })}</p>
        <InlineMessage>{errors.alert ?? null}</InlineMessage>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" aria-disabled={create.isPending || undefined}>
            {t('reports.generate')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
