'use client';

import type { PlatformOrgDetail } from '@mitaoe/shared';
import { Button, FileField, PageHeader, SelectField, TextAreaField, TextField } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { readLogo } from '@/lib/files';
import { qk } from '@/lib/query-keys';
import { TIMEZONES } from './timezones';

const INITIAL = { name: '', slug: '', timezone: 'Asia/Kolkata', departments: '' };

/** ORG-06: a new organization with name, unique slug, timezone, logo and its departments. */
export function OrgForm() {
  const router = useRouter();
  const qc = useQueryClient();
  const [values, setValues] = useState(INITIAL);
  const [logo, setLogo] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const logoInput = useRef<HTMLInputElement>(null);
  const dirty =
    logo !== null || (Object.keys(INITIAL) as Array<keyof typeof INITIAL>).some((k) => values[k] !== INITIAL[k]);
  const set = (k: keyof typeof INITIAL) => (e: { target: { value: string } }) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  const create = useMutation({
    mutationFn: async () => {
      const upload = logo ? await readLogo(logo) : undefined;
      if (logo && !upload) throw new ApiError(400, 'VALIDATION', t('org.logoType'), { field: 'logo' });
      return api<PlatformOrgDetail>('/v1/platform/orgs', {
        method: 'POST',
        body: {
          name: values.name.trim(),
          slug: values.slug.trim(),
          timezone: values.timezone,
          departments: values.departments
            .split('\n')
            .map((d) => d.trim())
            .filter(Boolean),
          ...(upload ? { logo: upload } : {}),
        },
      });
    },
    onSuccess: (org) => {
      void qc.invalidateQueries({ queryKey: qk.platformOrgs() });
      router.push(`/platform/org/?id=${encodeURIComponent(org.id)}`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'SLUG_TAKEN') setErrors({ slug: t('org.slugTaken') });
      else if (e instanceof ApiError && e.details.field === 'logo') setErrors({ logo: t('org.logoType') });
      else if (e instanceof ApiError && e.details.field === 'slug') setErrors({ slug: t('org.slugInvalid') });
      else setErrors({ form: t('common.saveFailed', { reason: e.message }) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!values.name.trim()) next.name = t('org.nameMissing');
    if (!values.slug.trim()) next.slug = t('org.slugMissing');
    else if (!/^[a-z0-9][a-z0-9-]{1,40}[a-z0-9]$/.test(values.slug.trim())) next.slug = t('org.slugInvalid');
    setErrors(next);
    if (Object.keys(next).length === 0) create.mutate();
  };

  const discard = () => {
    setValues(INITIAL);
    setLogo(null);
    setErrors({});
    if (logoInput.current) logoInput.current.value = '';
  };

  const required = t('common.requiredMark');
  return (
    <form noValidate onSubmit={submit} className="pb-28">
      <PageHeader title={t('org.new')} />
      <div className="flex max-w-measure flex-col gap-5">
        <TextField
          label={t('org.name')}
          requiredText={required}
          value={values.name}
          onChange={set('name')}
          error={errors.name}
        />
        <TextField
          label={t('org.urlSlug')}
          requiredText={required}
          value={values.slug}
          onChange={set('slug')}
          hint={t('org.slugHint')}
          error={errors.slug}
        />
        <SelectField
          label={t('org.timezone')}
          requiredText={required}
          value={values.timezone}
          onChange={set('timezone')}
          options={TIMEZONES.map((z) => ({ value: z, label: z }))}
        />
        <FileField
          ref={logoInput}
          label={t('org.logo')}
          hint={t('org.logoHint')}
          accept="image/png,image/jpeg,image/svg+xml"
          onChange={(e) => setLogo(e.target.files?.[0] ?? null)}
          error={errors.logo}
        />
        <TextAreaField
          label={t('org.departments')}
          hint={t('org.departmentsHint')}
          value={values.departments}
          onChange={set('departments')}
        />
        {errors.form ? <p className="font-bold text-redpen">{errors.form}</p> : null}
      </div>
      <section
        aria-label={t('common.formActions')}
        className="fixed inset-x-0 bottom-0 z-30 border-t border-rule bg-surface px-6 py-3 shadow-overlay"
      >
        <div className="mx-auto flex max-w-admin items-center justify-end gap-3">
          <p role="status" className="mr-auto text-graphite">
            {dirty ? t('common.unsaved') : null}
          </p>
          <Button variant="secondary" onClick={discard}>
            {t('common.discard')}
          </Button>
          <Button type="submit" disabled={create.isPending}>
            {t('org.create')}
          </Button>
        </div>
      </section>
    </form>
  );
}
