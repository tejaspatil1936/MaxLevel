// Every TanStack Query key starts with the organization it belongs to (WEB-05), so switching organizations can
// never show another org's cached data. Keys of the signed-in user come first with "user"; platform-wide keys with
// "platform".
export const qk = {
  me: (uid: string) => ['user', uid, 'me'] as const,
  /** Everything cached for one organization, for invalidating after a change. */
  orgAll: (orgId: string) => [orgId] as const,
  org: (orgId: string) => [orgId, 'org'] as const,
  orgList: (orgId: string, list: string, params: object = {}) => [orgId, list, params] as const,
  platformOrgs: () => ['platform', 'orgs'] as const,
  platformOrg: (orgId: string) => ['platform', 'orgs', orgId] as const,
  platformAudit: (params: object) => ['platform', 'audit', params] as const,
};
