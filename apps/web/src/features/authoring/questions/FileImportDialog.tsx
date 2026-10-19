'use client';

import {
  IMPORT_MAX_BYTES,
  importFormatLabel,
  importFormatOf,
  type ImportCreated,
  type ImportFormat,
  type ImportStarted,
} from '@mitaoe/shared';
import { Button, Dialog, FileField, InlineMessage } from '@mitaoe/ui';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { useWorkspace } from '@/lib/workspace';

/** Where a refusal shows: on the file field, or as the dialog's alert. */
type Problem = { field: string } | { alert: string };

/** The copy for an API refusal of this file (docs/testids/phase-6.md, "Upload dialog"). */
function problemOf(err: unknown, format: ImportFormat): Problem {
  if (!(err instanceof ApiError)) return { alert: t('imports.uploadFailed') };
  switch (err.code) {
    case 'UNSUPPORTED_FORMAT':
      return { field: t('imports.unsupported') };
    case 'FILE_TOO_LARGE':
      return { field: t('imports.tooLarge') };
    case 'FILE_SIGNATURE_MISMATCH':
      return { field: t('imports.mismatch', { format: importFormatLabel(format) }) };
    case 'LIMIT_REACHED':
      return { alert: t('imports.limitReached', { n: Number(err.details.max ?? 0) }) };
    case 'FEATURE_DISABLED':
      return { alert: t('imports.aiOff') };
    default:
      return { alert: t('imports.failed', { reason: err.message }) };
  }
}

/** PUTs the file to the signed upload link the API gave (no sign-in; DATA-09). */
async function uploadFile(url: string, file: File, contentType: string): Promise<void> {
  const res = await fetch(url, { method: 'PUT', headers: { 'content-type': contentType }, body: file }).catch(
    () => null,
  );
  if (!res?.ok) throw new Error('upload');
}

/**
 * IMP-01, IMP-02, SEC-06: `Start import` checks the extension and size in the browser, then creates the job, uploads
 * the file to its signed link and starts it; the API checks the stored file's signature and the AI allowance
 * (IMP-08). On success the browser goes to the import's review page.
 */
export function FileImportDialog({ testId, onClose }: { testId: string; onClose: () => void }) {
  const router = useRouter();
  const { features } = useWorkspace();
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const aiOff = features ? !features.ai_question_import : false;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const file = input.current?.files?.[0];
    if (!file) return setProblem({ field: t('imports.noFile') });
    const format = importFormatOf(file.name);
    if (!format) return setProblem({ field: t('imports.unsupported') });
    if (file.size > IMPORT_MAX_BYTES) return setProblem({ field: t('imports.tooLarge') });
    setProblem(null);
    setBusy(true);
    const contentType = file.type || 'application/octet-stream';
    try {
      const created = await api<ImportCreated>('/v1/imports', {
        method: 'POST',
        body: { testId, filename: file.name, contentType, sizeBytes: file.size },
        headers: { 'idempotency-key': crypto.randomUUID() },
      });
      await uploadFile(created.uploadUrl, file, contentType);
      await api<ImportStarted>(`/v1/imports/${encodeURIComponent(created.id)}/start`, { method: 'POST', body: {} });
      router.push(`/admin/imports/review/?id=${encodeURIComponent(created.id)}`);
    } catch (err) {
      setProblem(problemOf(err, format));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('imports.title')}>
      <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
        <FileField
          ref={input}
          label={t('imports.file')}
          requiredText={t('common.requiredMark')}
          hint={t('imports.formats')}
          accept=".json,.pdf,.xlsx,.csv,.txt,.md"
          error={problem && 'field' in problem ? problem.field : undefined}
          onChange={() => setProblem(null)}
        />
        {aiOff ? <p className="text-body-small text-graphite">{t('imports.aiOff')}</p> : null}
        {problem && 'alert' in problem ? <InlineMessage>{problem.alert}</InlineMessage> : null}
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" aria-disabled={busy || undefined}>
            {t('imports.submit')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
