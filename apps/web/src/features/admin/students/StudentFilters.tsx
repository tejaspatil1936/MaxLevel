'use client';

import type { Department, WhitelistStatus } from '@mitaoe/shared';
import { SelectField } from '@mitaoe/ui';
import { t } from '@/i18n';
import { graduationYears } from './years';

export interface StudentFilterValue {
  q: string;
  departmentId: string;
  year: string;
  status: WhitelistStatus | '';
}

/** Search and the three filters of the student directory (STU-08). */
export function StudentFilters({
  value,
  departments,
  onChange,
}: {
  value: StudentFilterValue;
  departments: Department[];
  onChange: (patch: Partial<StudentFilterValue>) => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end gap-4">
      <div className="flex min-w-64 flex-[2] flex-col gap-1">
        <label htmlFor="students-search" className="font-bold">
          {t('students.search')}
        </label>
        <input
          id="students-search"
          type="search"
          value={value.q}
          onChange={(e) => onChange({ q: e.target.value })}
          className="min-h-11 rounded-control border border-graphite bg-surface px-3"
        />
      </div>
      <div className="min-w-44 flex-1">
        <SelectField
          label={t('profile.department')}
          value={value.departmentId}
          onChange={(e) => onChange({ departmentId: e.target.value })}
          options={[
            { value: '', label: t('students.allDepartments') },
            ...departments.map((d) => ({ value: d.id, label: d.name })),
          ]}
        />
      </div>
      <div className="min-w-36 flex-1">
        <SelectField
          label={t('profile.year')}
          value={value.year}
          onChange={(e) => onChange({ year: e.target.value })}
          options={[
            { value: '', label: t('students.allYears') },
            ...graduationYears().map((y) => ({ value: y, label: y })),
          ]}
        />
      </div>
      <div className="min-w-36 flex-1">
        <SelectField
          label={t('org.status')}
          value={value.status}
          onChange={(e) => onChange({ status: e.target.value as WhitelistStatus | '' })}
          options={[
            { value: '', label: t('students.allStatuses') },
            { value: 'invited', label: t('status.invited') },
            { value: 'registered', label: t('status.registered') },
            { value: 'disabled', label: t('status.disabled') },
          ]}
        />
      </div>
    </div>
  );
}
