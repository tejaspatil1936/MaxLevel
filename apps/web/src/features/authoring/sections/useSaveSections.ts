'use client';

import type { TestDetail, TestPatch } from '@mitaoe/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import type { SectionInput } from './section-draft';

/** PATCH /v1/tests/{id} with a test's whole section list or its draw; the editor then shows the stored test. */
export function useSaveTest(test: TestDetail) {
  const { orgId } = useWorkspace();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TestPatch) =>
      api<TestDetail>(`/v1/tests/${encodeURIComponent(test.id)}`, { method: 'PATCH', body }),
    onSuccess: async (saved) => {
      qc.setQueryData(qk.orgItem(orgId, 'tests', test.id), saved);
      // Questions of a deleted section move to no section, so the question list changes too.
      await qc.invalidateQueries({ queryKey: qk.orgAll(orgId) });
    },
  });
}

/** Saves the section list in the order given: `order` follows the position (Q-03). */
export function useSaveSections(test: TestDetail) {
  const save = useSaveTest(test);
  return {
    ...save,
    mutate: (list: SectionInput[], opts?: Parameters<typeof save.mutate>[1]) =>
      save.mutate({ sections: list.map((s, i) => ({ ...s, order: i + 1 })) }, opts),
  };
}
