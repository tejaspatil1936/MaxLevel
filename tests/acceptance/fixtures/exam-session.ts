import type { Page } from '@playwright/test';
import { ExamScreen } from '../pages/exam-screen';
import type { ApiClient } from './api';
import { startAttempt, type ExamPayload } from './exam';
import { accounts, ORG_A, type SeedAccount } from './seed';
import type { RoleHome } from '../pages/role-home';
import type { ExamTestIds, ExamTestSeed, TestApi } from './test-api';

// Opening an attempt the quick way: seed a live test, sign the student in, start through the real API, then open
// /exam/?attempt= (the resume path, EX-05). Tests of the start flow itself go through the test page, preflight and
// rules instead.

export interface ExamFixtures {
  page: Page;
  signInAs: (account: SeedAccount) => Promise<RoleHome>;
  apiAs: (account: SeedAccount, opts?: { orgId?: string }) => Promise<ApiClient>;
  testApi: TestApi;
}

export interface OpenExam {
  t: ExamTestIds;
  api: ApiClient;
  payload: ExamPayload;
  attemptId: string;
  exam: ExamScreen;
}

/** The heading of the scenario's test (only test of its series, so `Day 1`). */
export const EXAM_HEADING = 'Day 1: Quantitative aptitude';

export async function openExam(
  f: ExamFixtures,
  seed: Partial<ExamTestSeed> = {},
  account: SeedAccount = accounts.studentA,
): Promise<OpenExam> {
  const t = await f.testApi.seedExamTest({ orgId: ORG_A.id, ...seed });
  // Sign in in the browser first, so the API client reuses the same Google account (same uid).
  await f.signInAs(account);
  const api = await f.apiAs(account);
  const payload = await startAttempt(api, t.testId);
  const exam = new ExamScreen(f.page);
  await exam.gotoAttempt(payload.attempt.id, seed.title ? undefined : EXAM_HEADING);
  return { t, api, payload, attemptId: payload.attempt.id, exam };
}
