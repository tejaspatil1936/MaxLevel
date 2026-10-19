'use client';

import {
  isAccommodationAmount,
  type AccommodationInput,
  type Accommodations,
  type Page,
  type Series,
  type StudentDetail,
} from '@mitaoe/shared';
import {
  Button,
  ConfirmDialog,
  Dialog,
  InlineMessage,
  notify,
  RadioGroup,
  SelectField,
  Skeleton,
  TextField,
} from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';

type Kind = 'pct' | 'min';

/** `<series>: 50% extra time`, `<series>: 15 extra minutes` or `<series>: 1 extra minute`. */
function itemText(series: string, a: AccommodationInput): string {
  if ('extraPct' in a) return t('accommodations.pct', { series, n: formatCount(a.extraPct) });
  return a.extraMin === 1
    ? t('accommodations.minOne', { series })
    : t('accommodations.min', { series, n: formatCount(a.extraMin) });
}

/**
 * OPS-07, A11Y-17: the student's standing accommodations by series in the student drawer, to add, replace or remove.
 * Each applies to attempts of the series' tests started afterwards.
 */
export function AccommodationsSection({ detail }: { detail: StudentDetail }) {
  const { orgId, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const studentId = detail.student.id;
  const series = useQuery({
    queryKey: qk.orgList(orgId, 'series'),
    queryFn: () => api<Page<Series>>('/v1/series?limit=200'),
  });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ seriesId: string; title: string } | null>(null);
  const detailKey = qk.orgList(orgId, 'student', { id: studentId });
  const changed = async (accommodations: Accommodations) => {
    qc.setQueryData<StudentDetail>(detailKey, (old) => (old ? { ...old, accommodations } : old));
    await qc.invalidateQueries({ queryKey: detailKey });
  };
  const url = (seriesId: string) =>
    `/v1/students/${encodeURIComponent(studentId)}/accommodations/${encodeURIComponent(seriesId)}`;
  const remove = useMutation({
    mutationFn: (seriesId: string) => api<{ accommodations: Accommodations }>(url(seriesId), { method: 'DELETE' }),
    onSuccess: async (res) => {
      setRemoving(null);
      notify.success(t('accommodations.removed'));
      await changed(res.accommodations);
    },
  });

  const titles = new Map((series.data?.items ?? []).map((s) => [s.id, s.title]));
  const items = Object.entries(detail.accommodations)
    .map(([seriesId, a]) => ({ seriesId, a, title: titles.get(seriesId) ?? seriesId }))
    .sort((x, y) => x.title.localeCompare(y.title));

  return (
    <section aria-labelledby="drawer-accommodations">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 id="drawer-accommodations" className="text-heading-2 font-bold">
          {t('accommodations.title')}
        </h3>
        <Button variant="secondary" onClick={() => setAdding(true)} disabled={readOnly || !series.data}>
          {t('accommodations.add')}
        </Button>
      </div>
      {!series.data ? (
        <Skeleton className="h-10 w-full" />
      ) : items.length ? (
        <ul aria-labelledby="drawer-accommodations" className="flex flex-col border-t border-rule">
          {items.map(({ seriesId, a, title }) => (
            <li key={seriesId} className="flex items-center justify-between gap-3 border-b border-rule py-1">
              <span>{itemText(title, a)}</span>
              <Button
                variant="ghost"
                aria-label={t('accommodations.removeFor', { series: title })}
                className="min-w-11 px-2"
                disabled={readOnly}
                onClick={() => setRemoving({ seriesId, title })}
              >
                <Trash2 aria-hidden size={18} />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-graphite">{t('accommodations.none')}</p>
      )}

      {adding ? (
        <AddAccommodationDialog
          series={(series.data?.items ?? []).filter((s) => s.status !== 'archived')}
          url={url}
          onSaved={async (accommodations) => {
            setAdding(false);
            notify.success(t('accommodations.saved'));
            await changed(accommodations);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {removing ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRemoving(null)}
          title={t('accommodations.removeConfirm', { series: removing.title })}
          description={t('accommodations.removeBody')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('accommodations.remove')}
          destructive
          confirmDisabled={remove.isPending}
          onConfirm={() => remove.mutate(removing.seriesId)}
        >
          {remove.isError ? (
            <InlineMessage>{t('common.saveFailed', { reason: remove.error.message })}</InlineMessage>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </section>
  );
}

/** The amount as a number, or NaN when the field does not hold a plain whole number. */
const amountOf = (text: string) => (/^\s*\d+\s*$/.test(text) ? Number(text) : Number.NaN);

function AddAccommodationDialog(p: {
  series: Series[];
  url: (seriesId: string) => string;
  onSaved: (a: Accommodations) => Promise<void>;
  onClose: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [seriesId, setSeriesId] = useState('');
  const [kind, setKind] = useState<Kind>('pct');
  const [amountText, setAmountText] = useState('');
  const [tried, setTried] = useState(0);
  const amount = amountOf(amountText);
  const errors = {
    series: seriesId ? null : t('accommodations.seriesMissing'),
    amount: isAccommodationAmount(kind, amount)
      ? null
      : t(kind === 'pct' ? 'accommodations.pctError' : 'accommodations.minError'),
  };
  // A11Y-11: after a refused save, focus moves to the first field in error.
  useEffect(() => {
    if (tried) form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [tried]);

  const save = useMutation({
    mutationFn: () =>
      api<{ accommodations: Accommodations }>(p.url(seriesId), {
        method: 'PUT',
        body: kind === 'pct' ? { extraPct: amount } : { extraMin: amount },
      }),
    onSuccess: (res) => p.onSaved(res.accommodations),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried((n) => n + 1);
    if (!errors.series && !errors.amount) save.mutate();
  };

  const required = t('common.requiredMark');
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && p.onClose()}
      title={t('accommodations.add')}
      description={t('accommodations.amountHint')}
    >
      <form ref={form} noValidate onSubmit={submit} className="flex flex-col gap-4">
        <SelectField
          label={t('accommodations.series')}
          requiredText={required}
          value={seriesId}
          onChange={(e) => setSeriesId(e.target.value)}
          placeholder={t('accommodations.seriesPlaceholder')}
          options={[...p.series]
            .sort((a, b) => a.title.localeCompare(b.title))
            .map((s) => ({ value: s.id, label: s.title }))}
          error={tried ? errors.series : null}
        />
        <RadioGroup<Kind>
          label={t('accommodations.kind')}
          value={kind}
          onValueChange={setKind}
          options={[
            { value: 'pct', label: t('accommodations.kindPct') },
            { value: 'min', label: t('accommodations.kindMin') },
          ]}
        />
        <TextField
          label={t('accommodations.amount')}
          requiredText={required}
          type="number"
          inputMode="numeric"
          min={1}
          max={kind === 'pct' ? 200 : 600}
          step={1}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          error={tried ? errors.amount : null}
        />
        {save.isError ? <InlineMessage>{t('common.saveFailed', { reason: save.error.message })}</InlineMessage> : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={p.onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('accommodations.save')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
