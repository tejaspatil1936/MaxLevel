import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);
const row = (n: number) => ({ studentId: `s${n}`, name: `S ${n}`, departmentId: 'd', score: 1, rank: n, timeSec: 0 });

beforeEach(async () => {
  await clearEmulators();
});

describe('leaderboards data access', () => {
  it('LB-03 DATA-04 ORG-03 reads a stored board with its later pages in order, and null before it is computed', async () => {
    const ref = db.doc('organizations/org-a/leaderboards/test_t1');
    expect(await data.leaderboards.getLeaderboard('org-a', 'test_t1')).toBeNull();
    await ref.set({ computedAt: 7, total: 3, pageCount: 3, rows: [row(1)] });
    await ref
      .collection('pages')
      .doc('1')
      .set({ rows: [row(2)] });
    await ref
      .collection('pages')
      .doc('2')
      .set({ rows: [row(3)] });
    expect(await data.leaderboards.getLeaderboard('org-a', 'test_t1')).toEqual({
      computedAt: 7,
      total: 3,
      rows: [row(1), row(2), row(3)],
    });
    expect(await data.leaderboards.getLeaderboard('org-b', 'test_t1'), 'another org').toBeNull();
  });
});
