'use client';

import type { ImportReport, WhitelistRow } from '@mitaoe/shared';
import { Button, Dialog, FileField, InlineMessage, RadioGroup, SelectField, Table, TextAreaField } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { guessMapping, mapRows, NotASheetError, parseSheet, pastedRows, type Mapping, type Sheet } from './parse';

type Step = 'source' | 'mapping' | 'report';
const NONE = '';

/** WL-02, WL-03: upload or paste, match columns, check the report, then save only the valid new rows. */
export function UploadWizard({ onClose, onSaved }: { onClose: () => void; onSaved: (added: number) => void }) {
  const [step, setStep] = useState<Step>('source');
  const [source, setSource] = useState<'upload' | 'paste'>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState('');
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ email: 0, prn: null, note: null });
  const [rows, setRows] = useState<WhitelistRow[]>([]);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = (mode: 'preview' | 'commit', body: WhitelistRow[]) =>
    api<ImportReport>('/v1/whitelist/import', { method: 'POST', body: { mode, source, rows: body } });
  const preview = useMutation({
    mutationFn: (r: WhitelistRow[]) => send('preview', r),
    onSuccess: (rep, r) => {
      setRows(r);
      setReport(rep);
      setStep('report');
    },
    onError: (e) => setError(e.message),
  });
  const commit = useMutation({
    mutationFn: () => send('commit', rows),
    onSuccess: (rep) => onSaved(rep.toAdd),
    onError: (e) => setError(e.message),
  });

  const next = async () => {
    setError(null);
    if (step === 'source' && source === 'paste') {
      const r = pastedRows(pasted);
      if (r.length === 0) return setError(t('wizard.pasteEmpty'));
      return preview.mutate(r);
    }
    if (step === 'source') {
      if (!file) return setError(t('wizard.fileMissing'));
      try {
        const s = await parseSheet(file);
        if (s.rows.length === 0) return setError(t('wizard.fileEmpty'));
        setSheet(s);
        setMapping(guessMapping(s.headers));
        setStep('mapping');
      } catch (e) {
        setError(t(e instanceof NotASheetError ? 'wizard.wrongFile' : 'wizard.unreadable'));
      }
      return;
    }
    if (step === 'mapping' && sheet) preview.mutate(mapRows(sheet, mapping).slice(0, 5000));
  };

  const columnOptions = (sheet?.headers ?? []).map((h, i) => ({
    value: String(i),
    label: h || t('wizard.column', { n: i + 1 }),
  }));
  const pick = (k: 'prn' | 'note') => (e: { target: { value: string } }) =>
    setMapping((m) => ({ ...m, [k]: e.target.value === NONE ? null : Number(e.target.value) }));

  const footer =
    step === 'report' ? (
      <>
        <Button variant="secondary" onClick={() => setStep(source === 'paste' ? 'source' : 'mapping')}>
          {t('wizard.back')}
        </Button>
        <Button
          onClick={() => commit.mutate()}
          disabled={!report || report.toAdd === 0 || report.overLimit || commit.isPending}
        >
          {t('wizard.save')}
        </Button>
      </>
    ) : (
      <>
        <Button variant="secondary" onClick={step === 'mapping' ? () => setStep('source') : onClose}>
          {step === 'mapping' ? t('wizard.back') : t('common.cancel')}
        </Button>
        <Button onClick={() => void next()} disabled={preview.isPending}>
          {t('common.continue')}
        </Button>
      </>
    );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('whitelist.upload')} footer={footer}>
      <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
        {step === 'source' ? (
          <>
            <h3 className="text-heading-3 font-bold">{t('wizard.sourceStep')}</h3>
            <RadioGroup<'upload' | 'paste'>
              label={t('wizard.source')}
              value={source}
              onValueChange={(v) => {
                setSource(v);
                setError(null);
              }}
              options={[
                { value: 'upload', label: t('wizard.uploadFile') },
                { value: 'paste', label: t('wizard.pasteList') },
              ]}
            />
            {source === 'upload' ? (
              <FileField
                label={t('wizard.file')}
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
                error={error}
              />
            ) : (
              <TextAreaField
                label={t('wizard.pasted')}
                value={pasted}
                onChange={(e) => setPasted(e.target.value)}
                error={error}
              />
            )}
          </>
        ) : null}

        {step === 'mapping' && sheet ? (
          <>
            <h3 className="text-heading-3 font-bold">{t('wizard.mappingStep')}</h3>
            <SelectField
              label={t('wizard.emailColumn')}
              requiredText={t('common.requiredMark')}
              value={String(mapping.email)}
              onChange={(e) => setMapping((m) => ({ ...m, email: Number(e.target.value) }))}
              options={columnOptions}
            />
            <SelectField
              label={t('wizard.prnColumn')}
              value={mapping.prn === null ? NONE : String(mapping.prn)}
              onChange={pick('prn')}
              options={[{ value: NONE, label: t('wizard.none') }, ...columnOptions]}
            />
            <SelectField
              label={t('wizard.noteColumn')}
              value={mapping.note === null ? NONE : String(mapping.note)}
              onChange={pick('note')}
              options={[{ value: NONE, label: t('wizard.none') }, ...columnOptions]}
            />
            <Table
              caption={t('wizard.preview')}
              rows={mapRows({ headers: sheet.headers, rows: sheet.rows.slice(0, 5) }, mapping).map((r, i) => ({
                ...r,
                i,
              }))}
              rowKey={(r) => String(r.i)}
              columns={[
                { key: 'email', header: t('field.email'), cell: (r) => r.email },
                { key: 'prn', header: t('profile.prn'), cell: (r) => r.prn ?? '' },
                { key: 'note', header: t('whitelist.note'), cell: (r) => r.note ?? '' },
              ]}
            />
            <InlineMessage>{error}</InlineMessage>
          </>
        ) : null}

        {step === 'report' && report ? <Report report={report} rows={rows} error={error} /> : null}
      </div>
    </Dialog>
  );
}

function Report({ report, rows, error }: { report: ImportReport; rows: WhitelistRow[]; error: string | null }) {
  const written = (row: number, email: string) => rows[row - 1]?.email.trim() ?? email;
  const problems: Array<{ row: number; email: string; problem: MessageKey }> = [
    ...report.invalid.map((p) => ({ ...p, problem: 'wizard.invalid' as const })),
    ...report.duplicatesInFile.map((p) => ({ ...p, problem: 'wizard.duplicate' as const })),
    ...report.existing.map((p) => ({ ...p, problem: 'wizard.existing' as const })),
  ].sort((a, b) => a.row - b.row);
  return (
    <>
      <h3 className="text-heading-3 font-bold">{t('wizard.reportStep')}</h3>
      <ul aria-label={t('wizard.report')} className="flex flex-col gap-1">
        <li>{t('wizard.ready', { n: formatCount(report.toAdd) })}</li>
        <li>{t('wizard.invalidCount', { n: formatCount(report.invalid.length) })}</li>
        <li>{t('wizard.duplicateCount', { n: formatCount(report.duplicatesInFile.length) })}</li>
        <li>{t('wizard.existingCount', { n: formatCount(report.existing.length) })}</li>
      </ul>
      {report.overLimit ? (
        <InlineMessage>
          {t('wizard.overLimit', {
            total: formatCount(report.currentCount + report.toAdd),
            max: formatCount(report.limit),
          })}
        </InlineMessage>
      ) : null}
      {problems.length ? (
        <Table
          caption={t('wizard.problems')}
          rows={problems}
          rowKey={(p) => `${p.row}-${p.problem}`}
          columns={[
            { key: 'row', header: t('wizard.row'), align: 'end', cell: (p) => formatCount(p.row) },
            { key: 'email', header: t('field.email'), cell: (p) => written(p.row, p.email) },
            { key: 'problem', header: t('wizard.problem'), cell: (p) => t(p.problem) },
          ]}
        />
      ) : null}
      <InlineMessage>{error}</InlineMessage>
    </>
  );
}
