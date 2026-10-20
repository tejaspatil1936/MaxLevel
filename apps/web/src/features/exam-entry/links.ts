// Where the exam entry flow goes; IDs travel in search params (WEB-02).
export const preflightUrl = (testId: string) => `/exam/preflight/?test=${encodeURIComponent(testId)}`;
export const rulesUrl = (testId: string) => `/exam/rules/?test=${encodeURIComponent(testId)}`;
export const attemptUrl = (attemptId: string) => `/exam/?attempt=${encodeURIComponent(attemptId)}`;

/** A link that is the page's primary action, drawn like the primary button. */
export const primaryLink =
  'inline-flex min-h-11 items-center justify-center rounded-control border border-ballpoint bg-ballpoint px-4 font-bold text-on-ballpoint hover:border-ink hover:bg-ink';
