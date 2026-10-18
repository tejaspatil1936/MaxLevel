'use client';

import type { QuestionList } from '@mitaoe/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';

export const questionsPath = (testId: string) => `/v1/tests/${encodeURIComponent(testId)}/questions`;

/** A test's questions in order, with data URLs for their images (GET /v1/tests/{id}/questions). */
export function useQuestions(testId: string) {
  const { orgId } = useWorkspace();
  return useQuery({
    queryKey: qk.orgList(orgId, 'questions', { testId }),
    queryFn: () => api<QuestionList>(questionsPath(testId)),
  });
}

/** After a question change: the list, and the test itself (its status and question set version change too). */
export function useQuestionsChanged(testId: string) {
  const { orgId } = useWorkspace();
  const qc = useQueryClient();
  return {
    key: qk.orgList(orgId, 'questions', { testId }),
    refresh: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.orgList(orgId, 'questions', { testId }) }),
        qc.invalidateQueries({ queryKey: qk.orgItem(orgId, 'tests', testId) }),
      ]),
  };
}
