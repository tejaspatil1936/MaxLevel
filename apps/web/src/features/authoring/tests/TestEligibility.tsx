'use client';

import type { EligibilityRules, Series, TestDetail } from '@mitaoe/shared';
import { Button, InlineMessage, notify, Skeleton } from '@mitaoe/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { t } from '@/i18n';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import { draftFromRules, resolveDraft, studentLookup, type StudentRef } from '../eligibility/eligibility-draft';
import { EligibilityEditor } from '../eligibility/EligibilityEditor';
import { useStudentRefs } from '../eligibility/useAuthoringData';

/** The Eligibility tab (SER-06, SER-07): the test's own rules, applied on top of the series rules. */
export function TestEligibility({ test, series }: { test: TestDetail; series: Series }) {
  const students = useStudentRefs();
  if (!students.data) return <Skeleton className="h-64 w-full" />;
  return <EligibilityForm test={test} series={series} students={students.data} />;
}

function EligibilityForm({ test, series, students }: { test: TestDetail; series: Series; students: StudentRef[] }) {
  const { orgId, readOnly } = useWorkspace();
  const qc = useQueryClient();
  const [value, setValue] = useState(() => draftFromRules(test.eligibility, students));
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const lookup = useMemo(() => studentLookup(students), [students]);
  // Focus the first list entry in error after a refused save (A11Y-11).
  useEffect(() => {
    if (submitted) document.querySelector<HTMLElement>('main [aria-invalid="true"]')?.focus();
  }, [submitted]);

  const save = useMutation({
    mutationFn: (eligibility: EligibilityRules) =>
      api<TestDetail>(`/v1/tests/${encodeURIComponent(test.id)}`, { method: 'PATCH', body: { eligibility } }),
    onSuccess: async (saved) => {
      qc.setQueryData(qk.orgItem(orgId, 'tests', test.id), saved);
      notify.success(t('tests.eligibilitySaved'));
      await qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
    },
    onError: (e) => setFormError(t('common.saveFailed', { reason: e.message })),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const { rules, unknown } = resolveDraft(value, lookup);
    if (unknown.include.length + unknown.exclude.length > 0) {
      setSubmitted(true);
      return;
    }
    save.mutate(rules);
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-5">
      <p className="text-graphite">{t('tests.eligibilityNote')}</p>
      <EligibilityEditor
        scope="test"
        value={value}
        onChange={setValue}
        previewPath={`/v1/tests/${encodeURIComponent(test.id)}/eligibility/preview`}
        students={students}
        showErrors={submitted}
        allowedDepartmentIds={series.eligibility.departmentIds}
        disabled={readOnly}
      />
      {formError ? <InlineMessage>{formError}</InlineMessage> : null}
      <div>
        <Button type="submit" disabled={readOnly || save.isPending}>
          {t('tests.saveEligibility')}
        </Button>
      </div>
    </form>
  );
}
