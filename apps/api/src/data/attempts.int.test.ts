import type { AttemptRecord } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';

const { db } = initFirebase();
const data = createData(db);

beforeEach(async () => {
  await clearEmulators();
});

describe('attempt data access', () => {
  it('US-ST-03 ORG-03 lists one student’s attempts in one org, newest first, without draw or result', async () => {
    const put = (orgId: string, id: string, fields: object) =>
      db.doc(`organizations/${orgId}/attempts/${id}`).set({ orgId, ...fields });
    await Promise.all([
      put('org-a', 'a1', {
        testId: 't1',
        seriesId: 's1',
        studentId: 'stu-1',
        status: 'submitted',
        startedAt: 100,
        submittedAt: 900,
        draw: { questionIds: ['q1'] },
        result: { score: 1 },
      }),
      put('org-a', 'a2', { testId: 't2', seriesId: 's1', studentId: 'stu-1', status: 'in_progress', startedAt: 2000 }),
      put('org-a', 'a3', { testId: 't1', seriesId: 's1', studentId: 'stu-2', status: 'submitted', startedAt: 100 }),
      put('org-b', 'b1', { testId: 't9', seriesId: 's9', studentId: 'stu-1', status: 'submitted', startedAt: 100 }),
    ]);
    expect(await data.attempts.listStudentAttempts('org-a', 'stu-1')).toEqual([
      { id: 'a2', testId: 't2', seriesId: 's1', status: 'in_progress', startedAt: 2000, submittedAt: null },
      { id: 'a1', testId: 't1', seriesId: 's1', status: 'submitted', startedAt: 100, submittedAt: 900 },
    ]);
    expect(await data.attempts.listStudentAttempts('org-c', 'stu-1')).toEqual([]);
  });

  const record = (id: string, over: Partial<AttemptRecord> = {}): AttemptRecord => ({
    id,
    orgId: 'org-a',
    testId: 't1',
    seriesId: 's1',
    studentId: 'stu-1',
    uid: 'u1',
    status: 'in_progress',
    startedAt: 1000,
    deadlineAt: 5000,
    extraTimeSec: 0,
    draw: {
      questionIds: ['q1'],
      optionOrder: { q1: ['a', 'b'] },
      sections: [{ sectionId: null, questionIds: ['q1'] }],
    },
    questionServedAt: {},
    strikesCount: 0,
    ...over,
  });
  const start = (build = (id: string) => record(id), firstStart = true) =>
    data.attempts.startAttempt('org-a', { testId: 't1', studentId: 'stu-1', firstStart }, build);

  it('DATA-02 EX-04 ten concurrent starts by one student for one test create exactly one attempt and one index entry', async () => {
    await db.doc('organizations/org-a/tests/t1').set({ orgId: 'org-a', attemptsStarted: false });
    const results = await Promise.all(Array.from({ length: 10 }, () => start()));

    const ids = new Set(results.map((r) => r.attempt.id));
    expect(ids.size, 'one attempt ID for every call').toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
    const stored = await db.collection('organizations/org-a/attempts').get();
    expect(stored.size).toBe(1);
    const index = await db.collection('organizations/org-a/attemptIndex').get();
    expect(index.docs.map((d) => [d.id, d.data()])).toEqual([
      ['t1_stu-1', { testId: 't1', studentId: 'stu-1', activeAttemptId: [...ids][0], attemptCount: 1 }],
    ]);
    expect((await db.doc('organizations/org-a/tests/t1').get()).get('attemptsStarted')).toBe(true);
    expect(await data.attempts.getAttempt('org-a', [...ids][0]!)).toEqual(record([...ids][0]!));
  });

  it('DATA-02 PR-13 a start uses the reserved attempt ID, a refused build stores nothing, and a reset attempt makes way', async () => {
    const ref = db.doc('organizations/org-a/attemptIndex/t1_stu-1');
    await ref.set({ testId: 't1', studentId: 'stu-1', reservedAttemptId: 'att-reserved', attemptCount: 0 });
    const refuse = () => {
      throw new AppError(409, 'WINDOW_CLOSED', 'Closed.');
    };
    await expect(start(refuse, false)).rejects.toMatchObject({ code: 'WINDOW_CLOSED' });
    expect((await db.collection('organizations/org-a/attempts').get()).size).toBe(0);

    const first = await start(undefined, false);
    expect(first).toMatchObject({ created: true, attempt: { id: 'att-reserved' } });
    expect((await ref.get()).data()).toEqual({
      testId: 't1',
      studentId: 'stu-1',
      activeAttemptId: 'att-reserved',
      attemptCount: 1,
    });
    expect((await start(refuse, false)).attempt.id, 'an active attempt is returned without building').toBe(
      'att-reserved',
    );

    await db.doc('organizations/org-a/attempts/att-reserved').update({ status: 'reset' });
    const again = await start(undefined, false);
    expect(again.created).toBe(true);
    expect(again.attempt.id).not.toBe('att-reserved');
    expect((await ref.get()).get('attemptCount')).toBe(2);
  });

  it('EX-05 ORG-03 reads an attempt and its saved answers in its own org only', async () => {
    const { attempt } = await start(undefined, false);
    await db
      .doc(`organizations/org-a/attempts/${attempt.id}/answers/q1`)
      .set({ optionId: 'b', seq: 2, clientTs: 1, serverTs: 2 });
    expect(await data.attempts.getAnswers('org-a', attempt.id)).toEqual({
      q1: { optionId: 'b', seq: 2, clientTs: 1, serverTs: 2 },
    });
    expect(await data.attempts.getAttempt('org-b', attempt.id)).toBeNull();
  });

  it('EX-11 EX-14 DATA-03 keeps each answer in its own record and writes only a higher seq', async () => {
    const answer = (questionId: string, seq: number, optionId: string | null) => ({
      questionId,
      optionId,
      seq,
      clientTs: 100 + seq,
    });
    const byNumber = (stored: number | undefined, seq: number) =>
      stored !== undefined && seq <= stored ? ('stale' as const) : ('saved' as const);
    const save = (a: ReturnType<typeof answer>) =>
      data.attempts.saveAnswer('org-a', 'att1', a, 999, (stored) => byNumber(stored, a.seq));

    // Out of order and concurrent: seq 3 wins whatever arrives last; another question never contends.
    const verdicts = await Promise.all([save(answer('q1', 3, 'c')), save(answer('q2', 1, 'a'))]);
    expect(verdicts).toEqual(['saved', 'saved']);
    expect(await save(answer('q1', 2, 'b'))).toBe('stale');
    expect(await save(answer('q1', 3, 'd'))).toBe('stale');
    expect(await data.attempts.getAnswers('org-a', 'att1')).toEqual({
      q1: { optionId: 'c', seq: 3, clientTs: 103, serverTs: 999, markedForReview: false },
      q2: { optionId: 'a', seq: 1, clientTs: 101, serverTs: 999, markedForReview: false },
    });
  });

  it('EX-13 a late answer is saved with lateSync and logs a late_sync event; a rejected one writes nothing', async () => {
    const base = { optionId: 'a', clientTs: 50 };
    expect(
      await data.attempts.saveAnswer('org-a', 'att1', { ...base, questionId: 'q1', seq: 1 }, 70, () => 'late_sync'),
    ).toBe('late_sync');
    expect(
      await data.attempts.saveAnswer(
        'org-a',
        'att1',
        { ...base, questionId: 'q2', seq: 1 },
        70,
        () => 'AFTER_DEADLINE',
      ),
    ).toBe('AFTER_DEADLINE');
    const answers = await data.attempts.getAnswers('org-a', 'att1');
    expect(Object.keys(answers)).toEqual(['q1']);
    expect(answers.q1).toMatchObject({ lateSync: true, seq: 1 });
    const events = await db.collection('organizations/org-a/attempts/att1/events').get();
    expect(events.docs.map((d) => d.data())).toEqual([
      { type: 'late_sync', details: { questionId: 'q1', seq: 1 }, clientTs: 50, serverTs: 70 },
    ]);
  });
});
