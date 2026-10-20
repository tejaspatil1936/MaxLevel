'use client';

import { extraTimeNeedsConfirmation, isGrantMinutes, type ExtraTimeResult } from '@mitaoe/shared';
import { Button, ConfirmDialog, Dialog, InlineMessage, notify, TextField } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatCount, formatZonedTime } from '@/lib/format';

const MIN = 60_000;

/** The typed minutes as a number, or NaN when the field does not hold a plain whole number. */
const minutesOf = (text: string) => (/^\s*\d+\s*$/.test(text) ? Number(text) : Number.NaN);

/**
 * Grant extra time (OPS-06, OPS-08, US-AD-12): whole minutes and a reason, the new deadline shown as the minutes are
 * typed, and a second confirmation when the minutes are more than the test's duration. Nothing is sent while a field
 * is in error; on success the dialog closes with a notice, and the row follows the new deadline from the live mirror.
 */
export function ExtraTimeDialog(p: {
  attemptId: string;
  name: string;
  deadlineAt: number;
  durationMin: number;
  timezone: string;
  onClose: () => void;
}) {
  const [minutesText, setMinutesText] = useState('');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const minutes = minutesOf(minutesText);
  const errors = {
    minutes: isGrantMinutes(minutes) ? null : t('live.extra.minutesError'),
    reason: reason.trim() ? null : t('live.extra.reasonError'),
  };
  // A11Y-11: after a refused grant, focus moves to the first field in error.
  useEffect(() => {
    if (tried) document.querySelector<HTMLElement>('[role=dialog] [aria-invalid="true"]')?.focus();
  }, [tried]);

  const grant = useMutation({
    mutationFn: (confirmOverDuration: boolean) =>
      api<ExtraTimeResult>(`/v1/attempts/${encodeURIComponent(p.attemptId)}/extra-time`, {
        method: 'POST',
        body: { minutes, reason: reason.trim(), ...(confirmOverDuration ? { confirmOverDuration: true } : {}) },
      }),
    onSuccess: () => {
      notify.success(t('live.extra.granted'));
      p.onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'EXTRA_TIME_CONFIRMATION_REQUIRED') setConfirming(true);
      else setFormError(t('common.saveFailed', { reason: err.message }));
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setTried((n) => n + 1);
    if (errors.minutes || errors.reason) return;
    if (extraTimeNeedsConfirmation(minutes, p.durationMin)) setConfirming(true);
    else grant.mutate(false);
  };

  const time = (ms: number) => formatZonedTime(ms, p.timezone);
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && p.onClose()} title={t('live.extra.title', { name: p.name })}>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <p>{t('live.extra.current', { time: time(p.deadlineAt) })}</p>
          <TextField
            label={t('live.extra.minutes')}
            requiredText={t('common.requiredMark')}
            type="number"
            inputMode="numeric"
            min={1}
            max={1440}
            step={1}
            value={minutesText}
            onChange={(e) => setMinutesText(e.target.value)}
            error={tried ? errors.minutes : null}
          />
          <TextField
            label={t('live.extra.reason')}
            requiredText={t('common.requiredMark')}
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            error={tried ? errors.reason : null}
          />
          {isGrantMinutes(minutes) ? (
            <p className="font-bold">{t('live.extra.new', { time: time(p.deadlineAt + minutes * MIN) })}</p>
          ) : null}
          {formError ? <InlineMessage>{formError}</InlineMessage> : null}
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={p.onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={grant.isPending}>
              {t('live.extra.grant')}
            </Button>
          </div>
        </form>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('live.extra.overTitle')}
        description={t('live.extra.overBody', { minutes: formatCount(minutes), duration: formatCount(p.durationMin) })}
        cancelLabel={t('common.cancel')}
        confirmLabel={t('live.extra.grantAnyway')}
        confirmDisabled={grant.isPending}
        onConfirm={() => {
          setConfirming(false);
          grant.mutate(true);
        }}
      />
    </>
  );
}
