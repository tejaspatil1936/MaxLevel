'use client';

import type { AuditEntry, StudentDetail } from '@mitaoe/shared';
import { Button, InlineMessage, SelectField, TextField } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api, ApiError } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { useDepartments } from './AddStudentDialog';
import { graduationYears } from './years';

const FIELD_LABEL: Record<string, Parameters<typeof t>[0]> = {
  name: 'profile.name',
  prn: 'profile.prn',
  departmentId: 'profile.department',
  graduationYear: 'profile.year',
  status: 'org.status',
  email: 'field.email',
};

export function HistoryItem({ entry, timeZone }: { entry: AuditEntry; timeZone: string }) {
  const before = (entry.before ?? {}) as Record<string, unknown>;
  const after = (entry.after ?? {}) as Record<string, unknown>;
  const keys = Object.keys(after).filter((k) => k in FIELD_LABEL && before[k] !== after[k] && k in before);
  return (
    <li className="rounded-control border border-rule p-3">
      <p className="text-body-small text-graphite">
        {formatDateTime(entry.createdAt, timeZone)} · {entry.actor.email} · {entry.action}
      </p>
      {keys.length ? (
        <div className="mt-1">
          {keys.map((k) => (
            <p key={k}>
              {t('students.changed', {
                field: t(FIELD_LABEL[k]!),
                from: String(before[k] ?? ''),
                to: String(after[k] ?? ''),
              })}
            </p>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function EditForm({ detail, onDone }: { detail: StudentDetail; onDone: () => void }) {
  const { orgId } = useWorkspace();
  const qc = useQueryClient();
  const s = detail.student;
  const departments = useDepartments(orgId);
  const [v, setV] = useState({
    name: s.name,
    prn: s.prn,
    departmentId: s.departmentId,
    graduationYear: String(s.graduationYear),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) =>
    setV((cur) => ({ ...cur, [k]: e.target.value }));
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if (v.name.trim() !== s.name) body.name = v.name.trim();
      if (v.prn.trim() !== s.prn) body.prn = v.prn.trim();
      if (v.departmentId !== s.departmentId) body.departmentId = v.departmentId;
      if (Number(v.graduationYear) !== s.graduationYear) body.graduationYear = Number(v.graduationYear);
      return Object.keys(body).length
        ? api(`/v1/students/${encodeURIComponent(s.id)}`, { method: 'PATCH', body })
        : Promise.resolve(null);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
      onDone();
    },
    onError: (e) =>
      setErrors(
        e instanceof ApiError && e.code === 'PRN_TAKEN' ? { prn: t('students.prnTaken') } : { form: e.message },
      ),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!v.name.trim()) next.name = t('students.nameMissing');
    if (!v.prn.trim()) next.prn = t('profile.prnMissing');
    setErrors(next);
    if (Object.keys(next).length === 0) save.mutate();
  };
  const required = t('common.requiredMark');
  const options = (departments.data?.items ?? [])
    .filter((d) => d.status === 'active' || d.id === s.departmentId)
    .map((d) => ({ value: d.id, label: d.name }));
  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
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
        options={options}
      />
      <SelectField
        label={t('profile.year')}
        requiredText={required}
        value={v.graduationYear}
        onChange={set('graduationYear')}
        options={graduationYears([s.graduationYear]).map((y) => ({ value: y, label: y }))}
      />
      <InlineMessage>{errors.form ?? null}</InlineMessage>
      <div className="flex gap-3">
        <Button type="submit" disabled={save.isPending}>
          {t('common.saveChanges')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
