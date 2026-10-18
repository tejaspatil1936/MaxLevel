'use client';

import type { Department, Page, Student } from '@mitaoe/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useWorkspace } from '@/lib/workspace';
import type { StudentRef } from './eligibility-draft';

/** The org's departments, shared with the Departments screen's cache. */
export function useDepartments() {
  const { orgId } = useWorkspace();
  return useQuery({
    queryKey: qk.orgList(orgId, 'departments'),
    queryFn: () => api<{ items: Department[] }>('/v1/departments'),
    select: (d) => d.items,
  });
}

/** Every student's ID, email and PRN, so include and exclude entries resolve as they are typed (SER-07). */
export function useStudentRefs() {
  const { orgId } = useWorkspace();
  return useQuery({
    queryKey: qk.orgList(orgId, 'students', { refs: true }),
    queryFn: async () => {
      const refs: StudentRef[] = [];
      let cursor: string | null = null;
      do {
        const page: Page<Student> = await api<Page<Student>>(
          `/v1/students?limit=200${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        );
        refs.push(...page.items.map((s) => ({ id: s.id, email: s.email, prn: s.prn })));
        cursor = page.nextCursor;
      } while (cursor);
      return refs;
    },
    staleTime: 60_000,
  });
}
