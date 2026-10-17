// Every TanStack Query key starts with the organization it belongs to (WEB-05), so switching organizations can
// never show another org's cached data. Keys of the signed-in user come first with "user".
export const qk = {
  me: (uid: string) => ['user', uid, 'me'] as const,
  org: (orgId: string) => [orgId, 'org'] as const,
};
