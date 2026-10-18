import { pairingTokenVerdict } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);
const T0 = 1_793_592_000_000;
const token = {
  testId: 't1',
  attemptId: 'att-1',
  studentId: 'stu-1',
  uid: 'u1',
  issuedAt: T0,
  expiresAt: T0 + 300_000,
};

beforeEach(async () => {
  await clearEmulators();
});

describe('pairing token data access', () => {
  it('PR-13 PR-14 ORG-03 a token is redeemed once, in its own org only, and an expired one stays unused', async () => {
    await data.pairing.createToken('org-a', 'k1', token);
    await data.pairing.createToken('org-a', 'k2', token);
    const redeem = (orgId: string, key: string, now: number) =>
      data.pairing.redeemToken(orgId, key, now, (r) => pairingTokenVerdict(r, now));

    expect(await redeem('org-b', 'k1', T0 + 1), 'another org has no such token').toBeNull();
    expect(await redeem('org-a', 'nope', T0 + 1)).toBeNull();
    const both = await Promise.all([redeem('org-a', 'k1', T0 + 1), redeem('org-a', 'k1', T0 + 1)]);
    expect(
      both.filter((r) => typeof r === 'object' && r !== null),
      'one redeem wins',
    ).toEqual([{ record: { orgId: 'org-a', ...token, usedAt: T0 + 1 } }]);
    expect(both).toContain('PAIRING_TOKEN_USED');
    expect(await redeem('org-a', 'k2', T0 + 300_000)).toBe('PAIRING_TOKEN_EXPIRED');
    expect((await db.doc('organizations/org-a/pairingTokens/k2').get()).get('usedAt')).toBeUndefined();
  });
});
