'use client';

import type { WhitelistStatus } from '@mitaoe/shared';
import { Button, Dialog, TextField, type Tone } from '@mitaoe/ui';
import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { t, type MessageKey } from '@/i18n';
import { api, ApiError } from '@/lib/api';

export const STATUS: Record<WhitelistStatus, { label: MessageKey; tone: Tone }> = {
  invited: { label: 'status.invited', tone: 'info' },
  registered: { label: 'status.registered', tone: 'success' },
  disabled: { label: 'status.disabled', tone: 'muted' },
};

export function AddEntryDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [prn, setPrn] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () =>
      api<{ toAdd: number; invalid: unknown[]; existing: unknown[] }>('/v1/whitelist/import', {
        method: 'POST',
        body: {
          mode: 'commit',
          source: 'single',
          rows: [
            {
              email: email.trim(),
              ...(prn.trim() ? { prn: prn.trim() } : {}),
              ...(note.trim() ? { note: note.trim() } : {}),
            },
          ],
        },
      }),
    onSuccess: (r) => {
      if (r.invalid.length) return setError(t('field.emailInvalid'));
      onDone();
      onClose();
    },
    onError: (e) => setError(e instanceof ApiError && e.code === 'EMAIL_EXISTS' ? t('whitelist.exists') : e.message),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError(t('field.emailInvalid'));
    setError(null);
    add.mutate();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('whitelist.addTitle')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('field.email')}
          requiredText={t('common.requiredMark')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error}
        />
        <TextField label={t('profile.prn')} value={prn} onChange={(e) => setPrn(e.target.value)} />
        <TextField label={t('whitelist.note')} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={add.isPending}>
            {t('whitelist.addEntry')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
