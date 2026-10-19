/** /admin/live/, or one test's live view with `?test=` (WEB-02). */
export const liveUrl = (testId?: string) =>
  testId ? `/admin/live/?test=${encodeURIComponent(testId)}` : '/admin/live/';
