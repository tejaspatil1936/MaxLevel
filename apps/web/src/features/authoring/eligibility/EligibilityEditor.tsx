'use client';

import type { EligibilityPreview } from '@mitaoe/shared';
import { Button, Checkbox, Dialog, Table, TextAreaField } from '@mitaoe/ui';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { graduationYears } from '@/features/admin/students/years';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { formatCount } from '@/lib/format';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { resolveDraft, studentLookup, type EligibilityDraft, type StudentRef } from './eligibility-draft';
import { useDepartments } from './useAuthoringData';

export interface EligibilityEditorProps {
  scope: 'series' | 'test';
  value: EligibilityDraft;
  onChange: (draft: EligibilityDraft) => void;
  /** POST endpoint of the live count, for example /v1/series/new/eligibility/preview. */
  previewPath: string;
  /** Every student's ID, email and PRN, to resolve list entries (undefined while loading). */
  students: readonly StudentRef[] | undefined;
  /** Show unknown-entry errors even on untouched lists (after a save attempt). */
  showErrors?: boolean;
  /** On a test, only the departments the series allows (all when the series has no department rule). */
  allowedDepartmentIds?: readonly string[];
  disabled?: boolean;
}

const toggle = <T,>(list: T[], item: T, on: boolean) => (on ? [...list, item] : list.filter((x) => x !== item));

/**
 * Departments, graduation years, include and exclude lists, with a live count of the students these rules admit
 * and the matching list (SER-05, SER-07). The count comes from the server without saving anything.
 */
export function EligibilityEditor(p: EligibilityEditorProps) {
  const { orgId } = useWorkspace();
  const departments = useDepartments();
  const [touched, setTouched] = useState({ include: false, exclude: false });
  const [listOpen, setListOpen] = useState(false);
  const lookup = useMemo(() => (p.students ? studentLookup(p.students) : undefined), [p.students]);
  const { rules, unknown } = resolveDraft(p.value, lookup);
  const preview = useQuery({
    queryKey: qk.orgList(orgId, 'eligibility-preview', { path: p.previewPath, rules }),
    queryFn: () => api<EligibilityPreview>(p.previewPath, { method: 'POST', body: { eligibility: rules } }),
    placeholderData: keepPreviousData,
  });

  const shownDepartments = (departments.data ?? []).filter(
    (d) =>
      (d.status === 'active' || p.value.departmentIds.includes(d.id)) &&
      (!p.allowedDepartmentIds?.length || p.allowedDepartmentIds.includes(d.id)),
  );
  const deptName = new Map((departments.data ?? []).map((d) => [d.id, d.name]));
  const set = (patch: Partial<EligibilityDraft>) => p.onChange({ ...p.value, ...patch });
  const listError = (k: 'include' | 'exclude') =>
    (touched[k] || p.showErrors) && unknown[k][0] ? t('eligibility.unknown', { entry: unknown[k][0] }) : null;
  const count = preview.data?.count;
  const title = t(`eligibility.title.${p.scope}`);

  return (
    <fieldset className="flex flex-col gap-5 rounded-panel border border-rule bg-surface p-5">
      <legend className="px-1 text-heading-2 font-bold">{title}</legend>
      <fieldset>
        <legend className="font-bold">{t('eligibility.departments')}</legend>
        <div className="mt-1 flex flex-wrap gap-x-6">
          {shownDepartments.map((d) => (
            <Checkbox
              key={d.id}
              label={d.name}
              disabled={p.disabled}
              checked={p.value.departmentIds.includes(d.id)}
              onCheckedChange={(on) => set({ departmentIds: toggle(p.value.departmentIds, d.id, on) })}
            />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="font-bold">{t('eligibility.years')}</legend>
        <div className="mt-1 flex flex-wrap gap-x-6">
          {graduationYears(p.value.graduationYears).map((y) => (
            <Checkbox
              key={y}
              label={y}
              disabled={p.disabled}
              checked={p.value.graduationYears.includes(Number(y))}
              onCheckedChange={(on) => set({ graduationYears: toggle(p.value.graduationYears, Number(y), on) })}
            />
          ))}
        </div>
      </fieldset>
      <div className="grid gap-5 md:grid-cols-2">
        {(['include', 'exclude'] as const).map((k) => (
          <TextAreaField
            key={k}
            label={t(`eligibility.${k}`)}
            hint={t('eligibility.entriesHint')}
            rows={4}
            disabled={p.disabled}
            value={p.value[k]}
            onChange={(e) => set({ [k]: e.target.value })}
            onBlur={() => setTouched((v) => ({ ...v, [k]: true }))}
            error={listError(k)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <p role="status" className="font-bold">
          {count === undefined
            ? null
            : t(count === 1 ? `eligibility.countOne.${p.scope}` : `eligibility.count.${p.scope}`, {
                n: formatCount(count),
              })}
        </p>
        <Button
          variant="secondary"
          disabled={!preview.data || preview.isPlaceholderData}
          onClick={() => setListOpen(true)}
        >
          {t('eligibility.showMatching')}
        </Button>
      </div>
      <Dialog
        open={listOpen}
        onOpenChange={setListOpen}
        title={title}
        footer={
          <Button variant="secondary" onClick={() => setListOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        <Table
          caption={t('eligibility.matching')}
          rows={preview.data?.students ?? []}
          rowKey={(s) => s.id}
          columns={[
            { key: 'name', header: t('field.name'), cell: (s) => s.name },
            { key: 'prn', header: t('profile.prn'), cell: (s) => s.prn },
            { key: 'department', header: t('profile.department'), cell: (s) => deptName.get(s.departmentId) ?? '' },
            { key: 'year', header: t('profile.year'), cell: (s) => String(s.graduationYear) },
          ]}
        />
      </Dialog>
    </fieldset>
  );
}
