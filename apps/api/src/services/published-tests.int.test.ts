import { TestClock } from '@mitaoe/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createData } from '../data';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { SCENARIOS } from '../test-support/scenarios';
import { seedBase } from '../test-support/seed';
import { publishedTestCache } from './published-tests';
import { questionImageStore } from './question-images';

const firebase = initFirebase();
const { db } = firebase;
const NOW = Date.UTC(2026, 10, 2, 4, 0);

beforeEach(async () => {
  await clearEmulators();
  await seedBase(db, NOW);
});

describe('published test cache', () => {
  it('PERF-01 caches questions by test ID and questionSetVersion: a second read reads no question records, a version bump is picked up', async () => {
    const data = createData(db);
    const read = vi.spyOn(data.questions, 'listQuestions');
    const cache = publishedTestCache(data, questionImageStore(firebase), new TestClock());
    const { testId } = await SCENARIOS['exam-test']!(db, NOW, { orgId: 'org-a' });
    const test = (await data.tests.getTest('org-a', String(testId)))!;

    const first = await cache.questions('org-a', test);
    expect(first.byId.size).toBe(4);
    expect(first.pools).toHaveLength(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(await cache.questions('org-a', test)).toBe(first);
    expect(read, 'the second read came from memory').toHaveBeenCalledTimes(1);
    expect(await cache.questions('org-b', test), 'another org is another key').not.toBe(first);
    expect(read).toHaveBeenCalledTimes(2);

    const [qid] = first.byId.keys();
    await db.doc(`organizations/org-a/tests/${test.id}/questions/${qid}`).update({ prompt: 'Changed' });
    const bumped = { ...test, questionSetVersion: test.questionSetVersion + 1 };
    expect((await cache.questions('org-a', bumped)).byId.get(qid!)?.prompt).toBe('Changed');
    expect(read).toHaveBeenCalledTimes(3);
  });
});
