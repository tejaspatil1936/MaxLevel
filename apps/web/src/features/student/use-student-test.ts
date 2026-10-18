import type { StudentTestPage } from '@mitaoe/shared';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useSession } from '@/lib/session';

/**
 * GET /v1/student/tests/{id}, shared by the test page, preflight and the rules screen; `notFound` is the API's 404 for
 * a test the dashboard would not list (US-ST-03).
 */
export function useStudentTest(testId: string) {
  const { session } = useSession();
  const orgId = session.status === 'ready' ? (session.me.orgId ?? '') : '';
  const query = useQuery({
    queryKey: qk.orgItem(orgId, 'student-test', testId),
    queryFn: () => api<StudentTestPage>(`/v1/student/tests/${encodeURIComponent(testId)}`),
    enabled: !!orgId && !!testId,
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });
  const notFound = !testId || (query.error instanceof ApiError && query.error.status === 404);
  return { query, notFound, orgId };
}
