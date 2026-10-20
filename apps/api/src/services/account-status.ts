import type { Clock } from '@mitaoe/shared';
import type { Data } from '../data';
import { AppError } from '../errors';
import type { AuthUser } from '../plugins/auth';
import { TtlCache } from './ttl-cache';

type Verdict = 'ok' | 'org_unavailable' | 'org_archived' | 'account_disabled';

/**
 * Account and organization status checks on every request, cached in memory for 60 seconds (AUTH-06, PERF-02).
 * Removing an admin or disabling a student also revokes their tokens, so access ends promptly either way.
 */
export function accountStatusService(data: Data, clock: Clock) {
  const cache = new TtlCache<Verdict>(clock);

  const verdict = (user: AuthUser, orgId: string): Promise<Verdict> =>
    cache.get(`${user.uid}:${user.role}:${orgId}`, async () => {
      const org = await data.orgs.getOrg(orgId);
      if (!org) return 'org_unavailable';
      if (user.role === 'superAdmin') return org.status === 'archived' ? 'org_archived' : 'ok';
      if (org.status !== 'active') return 'org_unavailable';
      if (user.role === 'admin')
        return (await data.admins.findActiveAdminByEmail(orgId, user.email)) ? 'ok' : 'account_disabled';
      if (user.role === 'student') {
        const entry = await data.whitelist.getWhitelistEntry(orgId, user.email);
        return entry && entry.status !== 'disabled' ? 'ok' : 'account_disabled';
      }
      return 'ok';
    });

  return {
    /** Throws when the account may not act in the org; archived orgs are read-only for super admins (ORG-07). */
    async assert(user: AuthUser, orgId: string, isWrite: boolean): Promise<void> {
      const v = await verdict(user, orgId);
      if (v === 'org_unavailable')
        throw new AppError(
          403,
          'ORG_SUSPENDED',
          'Your organization is not available right now. Ask your placement cell.',
        );
      if (v === 'account_disabled')
        throw new AppError(403, 'ACCOUNT_DISABLED', 'Your access has been removed. Ask your placement cell.');
      if (v === 'org_archived' && isWrite)
        throw new AppError(
          409,
          'ORG_ARCHIVED',
          'This organization is archived and read-only. Restore it to make changes.',
        );
    },
    /** Forget cached verdicts for an org (status change) or a user (removed, disabled). */
    invalidate: () => cache.clear(),
  };
}
export type AccountStatusService = ReturnType<typeof accountStatusService>;
