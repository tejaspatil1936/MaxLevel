'use client';

import type { OrgAdmin, PlatformOrgDetail } from '@mitaoe/shared';
import { Button, Dialog, FileField, InlineMessage, SelectField, TextField } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { readLogo } from '@/lib/files';
import { qk } from '@/lib/query-keys';
import { TIMEZONES } from './timezones';

export function EditOrgDialog({
  org,
  onClose,
  onSaved,
}: {
  org: PlatformOrgDetail;
  onClose: () => void;
  onSaved: (o: PlatformOrgDetail) => void;
}) {
  const [name, setName] = useState(org.name);
  const [timezone, setTimezone] = useState(org.timezone);
  const [logo, setLogo] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const save = useMutation({
    mutationFn: async () => {
      const upload = logo ? await readLogo(logo) : undefined;
      if (logo && !upload) throw new ApiError(400, 'VALIDATION', t('org.logoType'), { field: 'logo' });
      return api<PlatformOrgDetail>(`/v1/platform/orgs/${encodeURIComponent(org.id)}`, {
        method: 'PATCH',
        body: { name: name.trim(), timezone, ...(upload ? { logo: upload } : {}) },
      });
    },
    onSuccess: (o) => {
      onSaved(o);
      onClose();
    },
    onError: (e) =>
      setErrors(
        e instanceof ApiError && e.details.field === 'logo'
          ? { logo: t('org.logoType') }
          : { form: t('common.saveFailed', { reason: e.message }) },
      ),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErrors({ name: t('org.nameMissing') });
    setErrors({});
    save.mutate();
  };
  const required = t('common.requiredMark');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('org.edit')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('org.name')}
          requiredText={required}
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <SelectField
          label={t('org.timezone')}
          requiredText={required}
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          options={TIMEZONES.map((z) => ({ value: z, label: z }))}
        />
        <FileField
          label={t('org.logo')}
          hint={t('org.logoHint')}
          accept="image/png,image/jpeg,image/svg+xml"
          onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
          error={errors.logo}
        />
        <InlineMessage>{errors.form ?? null}</InlineMessage>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={save.isPending}>
            {t('common.saveChanges')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** ORG-08: an admin added by email gets access at their next sign-in. */
export function AddAdminDialog({ org, onClose }: { org: PlatformOrgDetail; onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const add = useMutation({
    mutationFn: () =>
      api<OrgAdmin>(`/v1/platform/orgs/${encodeURIComponent(org.id)}/admins`, {
        method: 'POST',
        body: { email: email.trim(), ...(name.trim() ? { name: name.trim() } : {}) },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.platformOrg(org.id) });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ADMIN_EXISTS') setErrors({ email: t('org.adminExists') });
      else if (e instanceof ApiError && e.details.field === 'email') setErrors({ email: t('field.emailInvalid') });
      else setErrors({ form: e.message });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErrors({ email: t('field.emailInvalid') });
    setErrors({});
    add.mutate();
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('org.addAdmin')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('field.email')}
          requiredText={t('common.requiredMark')}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
        />
        <TextField label={t('field.name')} value={name} onChange={(e) => setName(e.target.value)} />
        <InlineMessage>{errors.form ?? null}</InlineMessage>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={add.isPending}>
            {t('org.addAdmin')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
