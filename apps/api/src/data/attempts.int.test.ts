import type { AttemptRecord } from '@mitaoe/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../errors';
import { initFirebase } from '../firebase';
import { clearEmulators } from '../test-support/emulators';
import { createData } from '.';
import type { AttemptBuilder } from './attempts';

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

  it('OPS-02 ORG-03 lists every attempt of one test in one org, reset ones included, earliest start first', async () => {
    const put = (orgId: string, id: string, fields: object) =>
      db.doc(`organizations/${orgId}/attempts/${id}`).set({ orgId, seriesId: 's1', deadlineAt: 5000, ...fields });
    await Promise.all([
      put('org-a', 'a1', { testId: 't1', studentId: 'stu-1', status: 'reset', startedAt: 100, extraTimeSec: 60 }),
      put('org-a', 'a2', { testId: 't1', studentId: 'stu-1', status: 'in_progress', startedAt: 300, strikesCount: 2 }),
      put('org-a', 'a3', { testId: 't2', studentId: 'stu-2', status: 'submitted', startedAt: 200 }),
      put('org-b', 'b1', { testId: 't1', studentId: 'stu-9', status: 'submitted', startedAt: 50 }),
    ]);
    const base = { studentId: 'stu-1', deadlineAt: 5000 };
    expect(await data.attempts.listTestAttempts('org-a', 't1')).toEqual([
      { ...base, id: 'a1', status: 'reset', startedAt: 100, extraTimeSec: 60, strikesCount: 0 },
      { ...base, id: 'a2', status: 'in_progress', startedAt: 300, extraTimeSec: 0, strikesCount: 2 },
    ]);
  });

  it('US-ST-08 ORG-03 lists one student’s finished attempts in one org with their scores only', async () => {
    const put = (orgId: string, id: string, fields: object) =>
      db.doc(`organizations/${orgId}/attempts/${id}`).set({ orgId, testId: 't1', seriesId: 's1', ...fields });
    const result = { score: 3, max: 4, pct: 75, correct: 3 };
    await Promise.all([
      put('org-a', 'a1', {
        studentId: 'stu-1',
        status: 'submitted',
        submittedAt: 900,
        result,
        draw: { questionIds: ['q1'] },
      }),
      put('org-a', 'a2', { studentId: 'stu-1', status: 'terminated', testId: 't2', submittedAt: 950 }),
      put('org-a', 'a3', { studentId: 'stu-1', status: 'in_progress', testId: 't3' }),
      put('org-a', 'a4', { studentId: 'stu-1', status: 'reset', testId: 't4', result }),
      put('org-a', 'a5', { studentId: 'stu-2', status: 'submitted', result }),
      put('org-b', 'b1', { studentId: 'stu-1', status: 'submitted', result }),
    ]);
    const rows = await data.attempts.listFinishedAttempts('org-a', 'stu-1');
    expect(rows.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: 'a1', testId: 't1', seriesId: 's1', status: 'submitted', submittedAt: 900, score: 3, max: 4 },
      { id: 'a2', testId: 't2', seriesId: 's1', status: 'terminated', submittedAt: 950, score: null, max: null },
    ]);
    expect(await data.attempts.listFinishedAttempts('org-c', 'stu-1')).toEqual([]);
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
  const start = (build: AttemptBuilder = (id: string) => record(id), firstStart = true) =>
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

  it('PR-13 TST-06 a reservation keeps one attempt ID on the index, stores no attempt and refuses with nothing stored', async () => {
    const ref = db.doc('organizations/org-a/attemptIndex/t1_stu-1');
    const reserve = (check = () => {}) =>
      data.attempts.reserveAttempt('org-a', { testId: 't1', studentId: 'stu-1' }, check);
    await expect(
      reserve(() => {
        throw new AppError(409, 'WINDOW_NOT_OPEN', 'Not yet.');
      }),
    ).rejects.toMatchObject({ code: 'WINDOW_NOT_OPEN' });
    expect((await ref.get()).exists, 'a refusal stores no index entry').toBe(false);

    const reservations = await Promise.all(Array.from({ length: 5 }, () => reserve()));
    const [{ attemptId }] = reservations as [{ attemptId: string }];
    expect(new Set(reservations.map((r) => r.attemptId)).size, 'one reserved ID for every call').toBe(1);
    expect((await ref.get()).data()).toEqual({
      testId: 't1',
      studentId: 'stu-1',
      reservedAttemptId: attemptId,
      attemptCount: 0,
    });
    expect((await db.collection('organizations/org-a/attempts').get()).size).toBe(0);
    await expect(
      reserve(() => {
        throw new AppError(409, 'WINDOW_CLOSED', 'Closed.');
      }),
    ).rejects.toMatchObject({ code: 'WINDOW_CLOSED' });

    const started = await start(undefined, false);
    expect(started.attempt.id, 'Start uses the reserved ID').toBe(attemptId);
    const refuse = () => {
      throw new AppError(409, 'WINDOW_CLOSED', 'Closed.');
    };
    expect(await reserve(refuse), 'a started attempt is returned without the check').toEqual({
      attemptId,
      status: 'in_progress',
    });
    await db.doc(`organizations/org-a/attempts/${attemptId}`).update({ status: 'reset' });
    const next = await reserve();
    expect(next.attemptId).not.toBe(attemptId);
    expect((await ref.get()).data()).toMatchObject({ reservedAttemptId: next.attemptId, attemptCount: 1 });
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

  /** An in-progress attempt `att1` to save answers to. */
  const putAtt1 = () => {
    const { id: _id, ...fields } = record('att1');
    return db.doc('organizations/org-a/attempts/att1').set(fields);
  };

  it('EX-11 EX-14 DATA-03 keeps each answer in its own record and writes only a higher seq', async () => {
    await putAtt1();
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
    await putAtt1();
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
      { orgId: 'org-a', type: 'late_sync', details: { questionId: 'q1', seq: 1 }, clientTs: 50, serverTs: 70 },
    ]);
  });
  it('EX-17 REL-04 finishes an attempt once from its stored answers; repeats, other orgs and missing ones change nothing', async () => {
    const { attempt } = await start(undefined, false);
    await db
      .doc(`organizations/org-a/attempts/${attempt.id}/answers/q1`)
      .set({ optionId: 'a', seq: 1, clientTs: 1, serverTs: 2 });
    const result = {
      score: 1,
      max: 1,
      pct: 100,
      correct: 1,
      incorrect: 0,
      unanswered: 0,
      sections: {},
      durationSec: 4,
    };
    const seen: Array<Record<string, unknown>> = [];
    const finish =
      (status: 'submitted' | 'auto_submitted', submittedAt: number) =>
      (_a: AttemptRecord, answers: Record<string, unknown>) => {
        seen.push(answers);
        return { status, submittedAt, result };
      };

    const runs = await Promise.all([
      data.attempts.finalizeAttempt('org-a', attempt.id, finish('submitted', 6000)),
      data.attempts.finalizeAttempt('org-a', attempt.id, finish('auto_submitted', 7000)),
    ]);
    expect(
      runs.filter((r) => r?.finalized),
      'concurrent runs finish it once',
    ).toHaveLength(1);
    const stored = await data.attempts.getAttempt('org-a', attempt.id);
    expect(stored).toMatchObject({ status: runs.find((r) => r?.finalized)!.attempt.status, result });
    expect(seen[0]).toEqual({ q1: { optionId: 'a', seq: 1, clientTs: 1, serverTs: 2 } });

    const again = await data.attempts.finalizeAttempt('org-a', attempt.id, finish('auto_submitted', 9000));
    expect(again).toEqual({ attempt: stored, finalized: false });
    expect(await data.attempts.getAttempt('org-a', attempt.id)).toEqual(stored);
    expect(await data.attempts.finalizeAttempt('org-b', attempt.id, finish('submitted', 1))).toBeNull();
  });

  it('OPS-06 OPS-09 ORG-03 extra time adds up with its audit entry in one transaction; refusals store nothing', async () => {
    const ref = db.doc('organizations/org-a/attempts/a1');
    await ref.set({ orgId: 'org-a', testId: 't1', studentId: 'stu-1', status: 'in_progress', deadlineAt: 10_000 });
    const audit = db.collection('organizations/org-a/auditLogs');
    const write = (before: AttemptRecord, after: AttemptRecord, tx: FirebaseFirestore.Transaction) =>
      tx.create(audit.doc(), { before: before.deadlineAt, after: after.deadlineAt });

    expect(await data.attempts.grantExtraTime('org-a', 'a1', 600, write)).toMatchObject({
      deadlineAt: 610_000,
      extraTimeSec: 600,
    });
    expect(await data.attempts.grantExtraTime('org-a', 'a1', 60, write)).toMatchObject({
      deadlineAt: 670_000,
      extraTimeSec: 660,
    });
    expect((await ref.get()).data()).toMatchObject({ deadlineAt: 670_000, extraTimeSec: 660 });
    expect((await audit.get()).docs.map((d) => d.data()).sort((a, b) => a.after - b.after)).toEqual([
      { before: 10_000, after: 610_000 },
      { before: 610_000, after: 670_000 },
    ]);

    // A refusal thrown by the writer stores neither the grant nor its entry.
    const refuse = () => {
      throw new AppError(409, 'EXTRA_TIME_CONFIRMATION_REQUIRED', 'Confirm first.');
    };
    await expect(data.attempts.grantExtraTime('org-a', 'a1', 60, refuse)).rejects.toThrow('Confirm first.');
    expect(await data.attempts.grantExtraTime('org-b', 'a1', 60, write)).toBeNull();
    await ref.update({ status: 'submitted' });
    expect(await data.attempts.grantExtraTime('org-a', 'a1', 60, write)).toBe('ATTEMPT_FINISHED');
    expect((await ref.get()).data()).toMatchObject({ deadlineAt: 670_000, extraTimeSec: 660 });
    expect((await audit.get()).size).toBe(2);
  });

  it('OPS-04 AUD-02 ORG-03 terminating writes its audit entry in the finishing transaction; a reinstate undoes the finish', async () => {
    const { attempt } = await start(undefined, false);
    const audit = db.collection('organizations/org-a/auditLogs');
    const write = (before: AttemptRecord, after: AttemptRecord, tx: FirebaseFirestore.Transaction) =>
      tx.create(audit.doc(), { before: before.status, after: after.status });
    const result = { score: 0, max: 1, pct: 0, correct: 0, incorrect: 0, unanswered: 1, sections: {}, durationSec: 4 };
    const finish = () => ({ status: 'terminated' as const, submittedAt: 6000, result, terminationReason: 'Phone' });

    const ended = await data.attempts.finalizeAttempt('org-a', attempt.id, finish, write);
    expect(ended).toMatchObject({ finalized: true, attempt: { status: 'terminated', terminationReason: 'Phone' } });
    // A finished attempt is not finished again, and its writer does not run.
    expect(await data.attempts.finalizeAttempt('org-a', attempt.id, finish, write)).toMatchObject({ finalized: false });
    expect((await audit.get()).docs.map((d) => d.data())).toEqual([{ before: 'in_progress', after: 'terminated' }]);

    expect(await data.attempts.reinstateAttempt('org-b', attempt.id, write)).toBeNull();
    const back = await data.attempts.reinstateAttempt('org-a', attempt.id, write);
    expect(back).toEqual(record(attempt.id));
    expect(await data.attempts.getAttempt('org-a', attempt.id)).toEqual(record(attempt.id));
    expect(await data.attempts.reinstateAttempt('org-a', attempt.id, write)).toBe('ATTEMPT_NOT_TERMINATED');
    expect((await audit.get()).size).toBe(2);
  });

  it('OPS-10 US-AD-13 ORG-03 a reset keeps the attempt, frees the index and lets the next start know it follows a reset', async () => {
    const { attempt } = await start(undefined, false);
    const ref = db.doc(`organizations/org-a/attempts/${attempt.id}`);
    await ref.collection('answers').doc('q1').set({ optionId: 'a', seq: 1, clientTs: 1, serverTs: 2 });
    const audit = db.collection('organizations/org-a/auditLogs');
    const write = (_b: AttemptRecord, after: AttemptRecord, tx: FirebaseFirestore.Transaction) =>
      tx.create(audit.doc(), { after: after.status });
    const fields = { resetReason: 'Laptop crashed', resetAt: 7000, resetBy: 'admin-uid' };

    expect(await data.attempts.resetAttempt('org-b', attempt.id, fields, write)).toBeNull();
    const refuse = () => {
      throw new Error('refused');
    };
    await expect(data.attempts.resetAttempt('org-a', attempt.id, fields, refuse)).rejects.toThrow('refused');
    expect((await ref.get()).get('status')).toBe('in_progress');

    expect(await data.attempts.resetAttempt('org-a', attempt.id, fields, write)).toEqual({
      ...record(attempt.id),
      ...fields,
      status: 'reset',
    });
    expect(await data.attempts.getAttempt('org-a', attempt.id)).toEqual({
      ...record(attempt.id),
      ...fields,
      status: 'reset',
    });
    expect(await data.attempts.getAnswers('org-a', attempt.id)).toEqual({
      q1: { optionId: 'a', seq: 1, clientTs: 1, serverTs: 2 },
    });
    const index = db.doc('organizations/org-a/attemptIndex/t1_stu-1');
    expect((await index.get()).data()).toEqual({
      testId: 't1',
      studentId: 'stu-1',
      attemptCount: 1,
      resetAttemptId: attempt.id,
    });
    expect(await data.attempts.resetAttempt('org-a', attempt.id, fields, write)).toBe('ATTEMPT_ALREADY_RESET');
    expect((await audit.get()).size).toBe(1);

    // Pairing and the next start are told the newest attempt was reset; the start clears the mark.
    const seen: boolean[] = [];
    await data.attempts.reserveAttempt('org-a', { testId: 't1', studentId: 'stu-1' }, (s) => seen.push(s.afterReset));
    const again = await start((id, s) => {
      seen.push(s.afterReset);
      return record(id);
    }, false);
    expect(seen).toEqual([true, true]);
    expect(again.created).toBe(true);
    expect((await index.get()).data()).toEqual({
      testId: 't1',
      studentId: 'stu-1',
      activeAttemptId: again.attempt.id,
      attemptCount: 2,
    });
  });

  it('Q-12 ORG-03 stores a question’s first serve time once, and not on a finished, missing or other-org attempt', async () => {
    await putAtt1();
    const runs = await Promise.all([
      data.attempts.serveQuestion('org-a', 'att1', 'q1', 2000),
      data.attempts.serveQuestion('org-a', 'att1', 'q1', 2001),
    ]);
    const first = (runs[0] as { servedAt: number }).servedAt;
    expect(runs, 'concurrent serves agree on one time').toEqual([{ servedAt: first }, { servedAt: first }]);
    expect(await data.attempts.serveQuestion('org-a', 'att1', 'q1', 3000)).toEqual({ servedAt: first });
    expect(await data.attempts.serveQuestion('org-a', 'att1', 'q.2', 3000)).toEqual({ servedAt: 3000 });
    expect((await data.attempts.getAttempt('org-a', 'att1'))?.questionServedAt).toEqual({ q1: first, 'q.2': 3000 });

    expect(await data.attempts.serveQuestion('org-b', 'att1', 'q1', 3000)).toBeNull();
    await db.doc('organizations/org-a/attempts/att1').update({ status: 'submitted' });
    expect(await data.attempts.serveQuestion('org-a', 'att1', 'q3', 3000)).toBe('ATTEMPT_FINISHED');
    expect((await data.attempts.getAttempt('org-a', 'att1'))?.questionServedAt).toEqual({ q1: first, 'q.2': 3000 });
  });

  it('EX-11 EX-17 DATA-03 an answer saved while the attempt is finalized is graded or refused, never stored after grading', async () => {
    const ids = ['race1', 'race2', 'race3', 'race4', 'race5', 'race6'];
    await Promise.all(
      ids.map((id) => {
        const { id: _id, ...fields } = record(id, {
          draw: {
            questionIds: ['q1', 'q2'],
            optionOrder: { q1: ['a', 'b'], q2: ['a', 'b'] },
            sections: [{ sectionId: null, questionIds: ['q1', 'q2'] }],
          },
        });
        return db.doc(`organizations/org-a/attempts/${id}`).set(fields);
      }),
    );
    const result = { score: 0, max: 2, pct: 0, correct: 0, incorrect: 0, unanswered: 2, sections: {}, durationSec: 4 };
    const graded: Record<string, Record<string, unknown>> = {};
    const finalize = (id: string) =>
      data.attempts.finalizeAttempt('org-a', id, (_a, answers) => {
        graded[id] = answers;
        return { status: 'submitted', submittedAt: 6000, result };
      });
    const save = (id: string, questionId: string) =>
      data.attempts
        .saveAnswer('org-a', id, { questionId, optionId: 'a', seq: 1, clientTs: 4000 }, 4500, () => 'saved')
        .catch((e: unknown) => e);

    // The finalize and the save run together; another save arrives just after the attempt is finished.
    await Promise.all(ids.map((id) => Promise.all([finalize(id), save(id, 'q1')])));
    const late = await Promise.all(ids.map((id) => save(id, 'q2')));
    expect(late, 'a save after finishing is refused').not.toContain('saved');

    for (const id of ids)
      expect(await data.attempts.getAnswers('org-a', id), `${id}: stored answers are the graded ones`).toEqual(
        graded[id],
      );
  });
});
