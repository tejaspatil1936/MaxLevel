'use client';

import type { AttemptActionResult } from '@mitaoe/shared';
import { ConfirmDialog, InlineMessage, notify, TextField } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatZonedTime } from '@/lib/format';

export type AttemptReasonAction = 'terminate' | 'reinstate' | 'reset';

/** Terminate and reset end or set aside the student's work, so their confirm button is red pen (UX-02). */
const DESTRUCTIVE: Record<AttemptReasonAction, boolean> = { terminate: true, reinstate: false, reset: true };

/**
 * Terminate, reinstate or reset an attempt (OPS-04, OPS-10, US-AD-13): a confirmation with a required reason, focus
 * starting on Cancel. An empty reason shows its field error and sends nothing; on success the dialog closes with a
 * notice, and the row follows the new status from the live mirror.
 */
export function AttemptReasonDialog(p: {
  action: AttemptReasonAction;
  attemptId: string;
  name: string;
  deadlineAt: number | null;
  timezone: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(0);
  const error = reason.trim() ? null : t(`live.${p.action}.reasonError`);
  // A11Y-11: after a refused confirm, focus moves to the field in error.
  useEffect(() => {
    if (tried) document.querySelector<HTMLElement>('[role=alertdialog] [aria-invalid="true"]')?.focus();
  }, [tried]);

  const send = useMutation({
    mutationFn: () =>
      api<AttemptActionResult>(`/v1/attempts/${encodeURIComponent(p.attemptId)}/${p.action}`, {
        method: 'POST',
        body: { reason: reason.trim() },
      }),
    onSuccess: () => {
      notify.success(t(`live.${p.action}.done`));
      p.onClose();
    },
  });

  const description =
    p.action === 'reinstate'
      ? t('live.reinstate.body', { time: p.deadlineAt === null ? '' : formatZonedTime(p.deadlineAt, p.timezone) })
      : t(`live.${p.action}.body`);
  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && p.onClose()}
      title={t(`live.${p.action}.title`, { name: p.name })}
      description={description}
      cancelLabel={t('common.cancel')}
      confirmLabel={t(`live.action.${p.action}`)}
      destructive={DESTRUCTIVE[p.action]}
      confirmDisabled={send.isPending}
      onConfirm={() => {
        setTried((n) => n + 1);
        if (!error) send.mutate();
      }}
    >
      <TextField
        label={t('live.reason')}
        requiredText={t('common.requiredMark')}
        value={reason}
        maxLength={500}
        onChange={(e) => setReason(e.target.value)}
        error={tried ? error : null}
      />
      {send.isError ? (
        <div className="mt-4">
          <InlineMessage>{t('common.saveFailed', { reason: send.error.message })}</InlineMessage>
        </div>
      ) : null}
    </ConfirmDialog>
  );
}
