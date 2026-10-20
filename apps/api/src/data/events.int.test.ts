import type { AttemptRecord, StrikeVerdict } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);
const events = (orgId = 'org-a') => db.collection(`organizations/${orgId}/attempts/att1/events`);

beforeEach(async () => {
  await clearEmulators();
});

async function putAttempt(over: Partial<AttemptRecord> = {}, orgId = 'org-a') {
  await db.doc(`organizations/${orgId}/attempts/att1`).set({
    orgId,
    testId: 't1',
    seriesId: 's1',
    studentId: 'stu-1',
    uid: 'u1',
    status: 'in_progress',
    startedAt: 1000,
    deadlineAt: 900_000,
    extraTimeSec: 0,
    draw: { questionIds: [], optionOrder: {}, sections: [] },
    questionServedAt: {},
    strikesCount: 0,
    ...over,
  });
}

/** Counts every strike event with the next number from the stored count (no dedupe), to show the transaction. */
const always = (a: AttemptRecord): StrikeVerdict => ({
  counted: true,
  strikeNumber: a.strikesCount + 1,
  terminates: false,
});
const never = (): StrikeVerdict => ({ counted: false, terminates: false });
const report = (clientTs: number, type: 'tab_hidden' | 'context_menu' = 'tab_hidden') => ({
  type,
  clientTs,
  details: { n: clientTs },
});

describe('event data access', () => {
  it('PR-08 concurrent counted events each get their own strike number in the transaction, none lost', async () => {
    await putAttempt();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => data.events.recordEvent('org-a', 'att1', report(i), 5000 + i, always)),
    );
    const numbers = results.map((r) => (r && r !== 'ATTEMPT_FINISHED' ? r.event.strikeNumber : null));
    expect([...numbers].sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const stored = (await db.doc('organizations/org-a/attempts/att1').get()).data()!;
    expect(stored.strikesCount).toBe(10);
    expect(typeof stored.lastStrikeAt).toBe('number');
    expect((await events().get()).size).toBe(10);
  });

  it('PR-07 PR-11 an event that does not count is stored without a strike number and leaves the attempt alone', async () => {
    await putAttempt({ strikesCount: 1, lastStrikeAt: 4000 });
    const r = await data.events.recordEvent('org-a', 'att1', report(10, 'context_menu'), 5000, never);
    expect(r).toMatchObject({ attempt: { strikesCount: 1, lastStrikeAt: 4000 }, verdict: { counted: false } });
    expect((await db.doc('organizations/org-a/attempts/att1').get()).data()).toMatchObject({
      strikesCount: 1,
      lastStrikeAt: 4000,
    });
    expect((await events().get()).docs.map((d) => d.data())).toEqual([
      { orgId: 'org-a', type: 'context_menu', details: { n: 10 }, clientTs: 10, serverTs: 5000 },
    ]);
  });

  it('PR-11 lists every event in serverTs order, ties in the order written, and only in the attempt org', async () => {
    await putAttempt();
    await putAttempt({}, 'org-b');
    await data.events.recordEvent('org-a', 'att1', report(1), 7000, always);
    for (const n of [2, 3, 4]) await data.events.recordEvent('org-a', 'att1', report(n, 'context_menu'), 5000, never);
    await data.events.recordEvent('org-b', 'att1', report(9), 1000, always);

    const listed = await data.events.listEvents('org-a', 'att1');
    expect(listed.map((e) => [e.clientTs, e.serverTs, e.strikeNumber ?? null])).toEqual([
      [2, 5000, null],
      [3, 5000, null],
      [4, 5000, null],
      [1, 7000, 1],
    ]);
    expect(listed[0]).toEqual({
      id: expect.any(String),
      type: 'context_menu',
      details: { n: 2 },
      clientTs: 2,
      serverTs: 5000,
    });
    expect((await data.events.listEvents('org-b', 'att1')).map((e) => e.clientTs)).toEqual([9]);
    expect(await data.events.listEvents('org-c', 'att1')).toEqual([]);
  });

  it('PR-10 ORG-03 a finished, missing or other-org attempt stores no event', async () => {
    await putAttempt({ status: 'terminated', strikesCount: 3 });
    expect(await data.events.recordEvent('org-a', 'att1', report(1), 5000, always)).toBe('ATTEMPT_FINISHED');
    expect(await data.events.recordEvent('org-b', 'att1', report(1), 5000, always)).toBeNull();
    expect(await data.events.recordEvent('org-a', 'att2', report(1), 5000, always)).toBeNull();
    expect((await events().get()).size).toBe(0);
    expect((await db.doc('organizations/org-a/attempts/att1').get()).get('strikesCount')).toBe(3);
  });
});
