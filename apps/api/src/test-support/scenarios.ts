import type { Firestore } from 'firebase-admin/firestore';
import { AppError } from '../errors';
import { emailKey } from './seed';

// Scenario data on top of the base seed for acceptance tests (POST /__test/seed/:scenario, docs/testids).

type Scenario = (db: Firestore, now: number, body: Record<string, unknown>) => Promise<Record<string, string>>;

const emptyOrg: Scenario = async (db, now) => {
  const batch = db.batch();
  const org = db.doc('organizations/org-c');
  batch.set(org, {
    orgId: 'org-c',
    name: 'Empty College of Engineering',
    slug: 'empty',
    status: 'active',
    timezone: 'Asia/Kolkata',
    logoPath: null,
    planId: 'standard',
    featureOverrides: {},
    limitOverrides: {},
    profileLocked: false,
    createdAt: now,
  });
  batch.set(org.collection('admins').doc('adm-org-c-1'), {
    orgId: 'org-c',
    email: 'admin1@c.test',
    name: 'Admin 1',
    uid: null,
    status: 'active',
    addedBy: 'seed',
    addedAt: now,
  });
  batch.set(db.doc(`emailIndex/${emailKey('admin1@c.test')}`), { orgIds: ['org-c'] });
  await batch.commit();
  return { orgId: 'org-c' };
};

/** A closed test with one graded attempt by the student: 42 of 50, one strike. */
const studentAttempts: Scenario = async (db, now, body) => {
  const orgId = String(body.orgId ?? '');
  const studentId = String(body.studentId ?? '');
  const student = await db.doc(`organizations/${orgId}/students/${studentId}`).get();
  if (!student.exists) throw new AppError(404, 'NOT_FOUND', 'No such student for the scenario.');
  const org = db.doc(`organizations/${orgId}`);
  const series = org.collection('series').doc();
  const test = org.collection('tests').doc();
  const attempt = org.collection('attempts').doc();
  const batch = db.batch();
  batch.set(series, {
    orgId,
    title: 'Placement 2026',
    status: 'active',
    startDate: '2026-10-01',
    endDate: '2026-12-31',
    defaults: {},
    eligibility: { departmentIds: [], graduationYears: [], include: [], exclude: [] },
  });
  batch.set(test, {
    orgId,
    seriesId: series.id,
    title: 'Day 1: Aptitude',
    status: 'closed',
    scheduledDate: '2026-10-10',
    overrides: {},
    sections: [],
    questionSetVersion: 1,
    totalMarks: 50,
  });
  batch.set(attempt, {
    orgId,
    testId: test.id,
    seriesId: series.id,
    studentId,
    uid: student.get('uid') ?? null,
    status: 'submitted',
    startedAt: now - 3_600_000,
    deadlineAt: now - 60_000,
    submittedAt: now - 120_000,
    extraTimeSec: 0,
    strikesCount: 1,
    result: { score: 42, max: 50, pct: 84, sections: {}, correct: 42, incorrect: 5, unanswered: 3, durationSec: 3480 },
  });
  await batch.commit();
  return { seriesId: series.id, testId: test.id, attemptId: attempt.id };
};

export const SCENARIOS: Record<string, Scenario> = { 'empty-org': emptyOrg, 'student-attempts': studentAttempts };
