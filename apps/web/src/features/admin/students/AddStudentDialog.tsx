'use client';

import type { Department, Student } from '@mitaoe/shared';
import { Button, Dialog, InlineMessage, SelectField, TextField } from '@mitaoe/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { graduationYears } from './years';

export function useDepartments(orgId: string) {
  return useQuery({
    queryKey: qk.orgList(orgId, 'departments'),
    queryFn: () => api<{ items: Department[] }>('/v1/departments'),
  });
}

/** STU-08: search, filter, sort and pick columns; the row opens the detail drawer (UX-05). */

export function AddStudentDialog({ departments, onClose }: { departments: Department[]; onClose: () => void }) {
  const { orgId } = useWorkspace();
  const qc = useQueryClient();
  const [v, setV] = useState({ email: '', name: '', prn: '', departmentId: '', graduationYear: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((cur) => ({ ...cur, [k]: e.target.value }));
  const add = useMutation({
    mutationFn: () =>
      api<Student>('/v1/students', {
        method: 'POST',
        body: {
          ...v,
          email: v.email.trim(),
          name: v.name.trim(),
          prn: v.prn.trim(),
          graduationYear: Number(v.graduationYear),
        },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
      onClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'PRN_TAKEN') setErrors({ prn: t('students.prnTaken') });
      else if (e instanceof ApiError && e.code === 'EMAIL_EXISTS') setErrors({ email: t('whitelist.exists') });
      else setErrors({ form: e.message });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email.trim())) next.email = t('field.emailInvalid');
    if (!v.name.trim()) next.name = t('students.nameMissing');
    if (!v.prn.trim()) next.prn = t('profile.prnMissing');
    if (!v.departmentId) next.departmentId = t('students.departmentMissing');
    if (!v.graduationYear) next.graduationYear = t('students.yearMissing');
    setErrors(next);
    if (Object.keys(next).length === 0) add.mutate();
  };
  const required = t('common.requiredMark');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title={t('students.add')}>
      <form noValidate onSubmit={submit} className="flex flex-col gap-4">
        <TextField
          label={t('field.email')}
          requiredText={required}
          type="email"
          value={v.email}
          onChange={set('email')}
          error={errors.email}
        />
        <TextField
          label={t('profile.name')}
          requiredText={required}
          value={v.name}
          onChange={set('name')}
          error={errors.name}
        />
        <TextField
          label={t('profile.prn')}
          requiredText={required}
          value={v.prn}
          onChange={set('prn')}
          error={errors.prn}
        />
        <SelectField
          label={t('profile.department')}
          requiredText={required}
          value={v.departmentId}
          onChange={set('departmentId')}
          placeholder={t('profile.choose')}
          options={departments.filter((d) => d.status === 'active').map((d) => ({ value: d.id, label: d.name }))}
          error={errors.departmentId}
        />
        <SelectField
          label={t('profile.year')}
          requiredText={required}
          value={v.graduationYear}
          onChange={set('graduationYear')}
          placeholder={t('profile.choose')}
          options={graduationYears().map((y) => ({ value: y, label: y }))}
          error={errors.graduationYear}
        />
        <InlineMessage>{errors.form ?? null}</InlineMessage>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={add.isPending}>
            {t('students.add')}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
