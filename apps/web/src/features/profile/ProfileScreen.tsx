'use client';

import type { StudentProfile } from '@mitaoe/shared';
import { Button, InlineMessage, PageHeader, SelectField, Skeleton, TextField } from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError, serverNow } from '@/lib/api';
import { useSession } from '@/lib/session';

const key = (orgId: string, uid: string) => [orgId, 'profile', uid] as const;

/** First sign-in: the consent notice (SEC-08), then profile completion (STU-01 to STU-03). */
export function ProfileScreen() {
  const { session } = useSession();
  const me = session.status === 'ready' ? session.me : null;
  const profile = useQuery({
    queryKey: key(me?.orgId ?? '', me?.uid ?? ''),
    queryFn: () => api<StudentProfile>('/v1/me/profile'),
    enabled: !!me,
  });
  if (!me || !profile.data) {
    return (
      <div aria-busy="true" aria-label={t('app.loading')}>
        <Skeleton className="h-12 w-72" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }
  return profile.data.consentGiven ? (
    <ProfileForm profile={profile.data} queryKey={key(me.orgId ?? '', me.uid)} />
  ) : (
    <Consent queryKey={key(me.orgId ?? '', me.uid)} />
  );
}

function Consent({ queryKey }: { queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { refresh } = useSession();
  const agree = useMutation({
    mutationFn: () => api<StudentProfile>('/v1/me/consent', { method: 'POST', body: {} }),
    onSuccess: async (p) => {
      qc.setQueryData(queryKey, p);
      // A manually added student already has every field, so consent completes the profile.
      if (p.complete) {
        await refresh();
        router.push('/student/');
      }
    },
  });
  return (
    <article className="max-w-measure">
      <h1 className="font-display text-display-2 font-bold">{t('consent.title')}</h1>
      <p className="mt-4">{t('consent.collect')}</p>
      <p className="mt-3">{t('consent.why')}</p>
      <p className="mt-3">{t('consent.rights')}</p>
      <div className="mt-6 flex flex-col items-start gap-3">
        <Button size="lg" onClick={() => agree.mutate()} disabled={agree.isPending}>
          {t('consent.agree')}
        </Button>
        <InlineMessage>{agree.isError ? t('common.saveFailed', { reason: '' }).trim() : null}</InlineMessage>
      </div>
    </article>
  );
}

function ProfileForm({ profile, queryKey }: { profile: StudentProfile; queryKey: readonly unknown[] }) {
  const qc = useQueryClient();
  const router = useRouter();
  const { refresh } = useSession();
  const first = !profile.complete;
  const locked = profile.editingLocked;
  const [name, setName] = useState(profile.name ?? '');
  const [prn, setPrn] = useState(profile.prn ?? '');
  const [departmentId, setDepartmentId] = useState(profile.departmentId ?? '');
  const [year, setYear] = useState(profile.graduationYear ? String(profile.graduationYear) : '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);

  const thisYear = new Date(serverNow()).getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => String(thisYear - 1 + i));
  if (profile.graduationYear && !years.includes(String(profile.graduationYear)))
    years.unshift(String(profile.graduationYear));

  const save = useMutation({
    mutationFn: () =>
      api<StudentProfile>('/v1/me/profile', {
        method: 'PUT',
        body: { name: name.trim(), prn: prn.trim(), departmentId, graduationYear: Number(year) },
      }),
    onSuccess: async (p) => {
      qc.setQueryData(queryKey, p);
      if (first) {
        await refresh();
        router.push('/student/');
      } else setSaved(true);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'PRN_TAKEN') setErrors({ prn: t('profile.prnTaken') });
      else if (e instanceof ApiError && e.code === 'PROFILE_LOCKED') setErrors({ form: t('profile.locked') });
      else setErrors({ form: t('common.saveFailed', { reason: e.message }) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = t('profile.nameMissing');
    if (!prn.trim()) next.prn = t('profile.prnMissing');
    if (!departmentId) next.departmentId = t('profile.departmentMissing');
    if (!year) next.graduationYear = t('profile.yearMissing');
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };

  const required = t('common.requiredMark');
  return (
    <>
      <PageHeader title={t(first ? 'profile.complete' : 'profile.title')} />
      {locked ? <p className="mb-6 max-w-measure font-bold">{t('profile.locked')}</p> : null}
      <form noValidate onSubmit={submit} className="flex max-w-measure flex-col gap-5">
        <TextField
          label={t('profile.name')}
          requiredText={required}
          value={name}
          onChange={(e) => setName(e.target.value)}
          readOnly={locked}
          autoComplete="name"
          error={errors.name}
        />
        <TextField
          label={t('profile.prn')}
          requiredText={required}
          value={prn}
          onChange={(e) => setPrn(e.target.value)}
          readOnly={locked || profile.prnLocked}
          hint={profile.prnLocked && !locked ? t('profile.prnFromList') : undefined}
          error={errors.prn}
        />
        <SelectField
          label={t('profile.department')}
          requiredText={required}
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          disabled={locked}
          placeholder={t('profile.choose')}
          options={profile.departments.map((d) => ({ value: d.id, label: d.name }))}
          error={errors.departmentId}
        />
        <SelectField
          label={t('profile.year')}
          requiredText={required}
          value={year}
          onChange={(e) => setYear(e.target.value)}
          disabled={locked}
          placeholder={t('profile.choose')}
          options={years.map((y) => ({ value: y, label: y }))}
          error={errors.graduationYear}
        />
        <InlineMessage>{errors.form ?? null}</InlineMessage>
        {saved ? <InlineMessage tone="success">{t('profile.saved')}</InlineMessage> : null}
        {locked ? null : (
          <div>
            <Button type="submit" size="lg" disabled={save.isPending}>
              {t(first ? 'profile.saveContinue' : 'common.saveChanges')}
            </Button>
          </div>
        )}
      </form>
    </>
  );
}
