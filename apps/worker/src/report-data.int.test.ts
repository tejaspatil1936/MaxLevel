import { beforeEach, describe, expect, it } from 'vitest';
import { initFirestore } from './firebase';
import { ReportLeaseLost, reportData } from './report-data';
import { clearFirestore } from './test-support/emulators';

// What the report task reads and writes (EXP-04, EXP-06, REL-04) on the Firestore emulator.

const db = initFirestore();
const data = reportData(db);
const org = db.doc('organizations/org-a');

beforeEach(async () => {
  await clearFirestore();
  await org.set({ orgId: 'org-a', name: 'MIT Academy of Engineering', timezone: 'Asia/Kolkata' });
  for (const [id, name] of [
    ['dep-it', 'IT'],
    ['dep-cs', 'Computer'],
  ] as const)
    await org.collection('departments').doc(id).set({ orgId: 'org-a', name });
  for (const [id, departmentId, status] of [
    ['s1', 'dep-cs', 'registered'],
    ['s2', 'dep-it', 'registered'],
    ['s3', 'dep-it', 'registered'],
    ['s4', 'dep-cs', 'invited'],
    ['s5', 'dep-mech', 'registered'],
  ] as const)
    await org.collection('students').doc(id).set({ orgId: 'org-a', departmentId, graduationYear: 2027, status });
  await org
    .collection('series')
    .doc('ser')
    .set({
      orgId: 'org-a',
      title: 'Placement 2026',
      status: 'active',
      eligibility: { departmentIds: ['dep-cs', 'dep-it'] },
    });
  const test = (id: string, scheduledDate: string, extra: object) =>
    org
      .collection('tests')
      .doc(id)
      .set({ orgId: 'org-a', seriesId: 'ser', title: 'Aptitude', scheduledDate, ...extra });
  await test('t1', '2026-11-01', { totalMarks: 2, resolved: { window: { start: 100, end: 200 } }, sections: [] });
  await test('t2', '2026-11-02', { totalMarks: 4, resolved: { window: { start: 300, end: 400 } } });
  await test('t3', '2026-11-03', { totalMarks: 4 });
  const q = org.collection('tests').doc('t1').collection('questions');
  await q.doc('qb').set({ orgId: 'org-a', order: 2, status: 'approved', options: [{ id: 'x', text: '7' }] });
  await q.doc('qa').set({
    orgId: 'org-a',
    order: 1,
    status: 'approved',
    sectionId: null,
    options: [
      { id: 'a', text: '24 m/s' },
      { id: 'b', text: '20 m/s' },
    ],
    correctOptionIds: ['b'],
  });
  await q.doc('qdraft').set({ orgId: 'org-a', order: 3, status: 'draft', options: [] });
  const attempt = (id: string, testId: string, studentId: string, status: string, score?: number) =>
    org
      .collection('attempts')
      .doc(id)
      .set({
        orgId: 'org-a',
        testId,
        studentId,
        status,
        strikesCount: 1,
        draw: { questionIds: ['qa', 'qb'] },
        ...(score === undefined ? {} : { result: { score, durationSec: 300, sections: {} } }),
      });
  await attempt('a1', 't1', 's1', 'submitted', 2);
  await org.collection('attempts').doc('a1').collection('answers').doc('qa').set({ optionId: 'b' });
  await attempt('a2', 't1', 's2', 'terminated', 0);
  await attempt('a3', 't1', 's3', 'in_progress');
  await attempt('a4', 't1', 's3', 'reset', 1);
  await attempt('a5', 't2', 's2', 'auto_submitted', 3);
});

describe('report data access', () => {
  it('EXP-04 ORG-03 reads a test: approved questions in order, finished attempts with answers and departments', async () => {
    const inputs = await data.testInputs('org-a', 't1');
    expect(inputs).toMatchObject({ maxScore: 2, eligible: 3, inProgress: 1, sections: [] });
    expect(inputs!.questions.map((q) => q.id)).toEqual(['qa', 'qb']);
    expect(inputs!.questions[0]).toEqual({
      id: 'qa',
      sectionId: null,
      options: [
        { id: 'a', text: '24 m/s' },
        { id: 'b', text: '20 m/s' },
      ],
      correctOptionIds: ['b'],
    });
    expect(
      inputs!.departments.map((d) => d.name),
      'by name, the organization order',
    ).toEqual(['Computer', 'IT']);
    expect(inputs!.attempts.map((a) => [a.studentId, a.status, a.score, a.departmentId])).toEqual([
      ['s1', 'submitted', 2, 'dep-cs'],
      ['s2', 'terminated', 0, 'dep-it'],
    ]);
    expect(inputs!.attempts[0]).toMatchObject({ answers: { qa: 'b', qb: null }, drawQuestionIds: ['qa', 'qb'] });
    expect(await data.testInputs('org-a', 't3'), 'not published').toBeNull();
    expect(await data.testInputs('org-b', 't1'), 'another organization').toBeNull();
  });

  it('EXP-04 reads a series: its published tests with headings, windows and finished attempts', async () => {
    const inputs = await data.seriesInputs('org-a', 'ser');
    expect(inputs!.eligible).toBe(3);
    expect(inputs!.tests.map((t) => [t.id, t.heading, t.scheduledDate, t.windowStart, t.maxScore])).toEqual([
      ['t1', 'Day 1: Aptitude', '2026-11-01', 100, 2],
      ['t2', 'Day 2: Aptitude', '2026-11-02', 300, 4],
    ]);
    expect(inputs!.tests[1]!.attempts.map((a) => [a.studentId, a.score])).toEqual([['s2', 3]]);
    expect(await data.seriesInputs('org-a', 'nope')).toBeNull();
    expect(await data.orgInfo('org-a')).toEqual({ name: 'MIT Academy of Engineering', timezone: 'Asia/Kolkata' });
  });

  it('REL-04 REL-06 one run holds a report under its lease; ready, waiting and held reports are left alone', async () => {
    const ref = org.collection('reports').doc('r1');
    await ref.set({ orgId: 'org-a', scope: 'test', refId: 't1', status: 'queued', createdAt: 1 });
    const claim = await data.claim('org-a', 'r1', { runId: 'run-1', now: 10, leaseUntil: 100 });
    expect(claim).toMatchObject({ kind: 'claimed', report: { id: 'r1', status: 'running' } });
    expect(await data.claim('org-a', 'r1', { runId: 'run-2', now: 50, leaseUntil: 150 })).toEqual({
      kind: 'held',
      heldUntil: 100,
    });
    expect(await data.claim('org-a', 'r1', { runId: 'run-2', now: 100, leaseUntil: 200 })).toMatchObject({
      kind: 'claimed',
    });
    await expect(data.update('org-a', 'r1', 'run-1', { summaryCalls: 1 })).rejects.toBeInstanceOf(ReportLeaseLost);
    await data.update('org-a', 'r1', 'run-2', { status: 'retrying', retryAt: 500, leaseUntil: null });
    expect((await ref.get()).get('leaseUntil'), 'null removes a field').toBeUndefined();
    expect(await data.claim('org-a', 'r1', { runId: 'run-3', now: 499, leaseUntil: 600 })).toEqual({
      kind: 'waiting',
      retryAt: 500,
    });
    await ref.update({ status: 'ready' });
    expect(await data.claim('org-a', 'r1', { runId: 'run-3', now: 600, leaseUntil: 700 })).toEqual({ kind: 'done' });
    expect(await data.claim('org-a', 'missing', { runId: 'run-3', now: 600, leaseUntil: 700 })).toEqual({
      kind: 'done',
    });
  });
});
