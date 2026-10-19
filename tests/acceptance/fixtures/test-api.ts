import { expect, type APIRequestContext } from '@playwright/test';
import { API_URL, TEST_SECRET } from '../../env';
import type { LlmScript } from './import-files';

// The API's test-only routes (docs/TEST_ENV.md, "Test-only API"). Registered only when NODE_ENV=test.

/** One model call the mock received: its page and the parts of its user message. */
export interface LlmCall {
  page: number;
  parts: Array<{ type: 'text' } | { type: 'file'; mediaType: string }>;
}

export interface PendingTask {
  name: string;
  path: string;
  scheduleTime: number;
}

export class TestApi {
  constructor(private readonly request: APIRequestContext) {}

  private async call<T>(method: 'GET' | 'POST', path: string, data?: unknown): Promise<T> {
    const res = await this.request.fetch(`${API_URL}${path}`, {
      method,
      headers: { 'x-test-secret': TEST_SECRET },
      ...(data === undefined ? {} : { data }),
    });
    expect(res.status(), `${method} ${path}: ${await res.text()}`).toBe(200);
    return (await res.json()) as T;
  }

  /** Clears all four emulators, puts the clock back on real time and loads the seed. */
  async reset(seed: 'base' | 'none' = 'base'): Promise<void> {
    await this.call('POST', '/__test/reset', { seed });
  }

  /** Adds scenario data (for example a scheduled test) and returns its IDs. */
  async seedScenario<T = Record<string, unknown>>(scenario: string, options: Record<string, unknown> = {}): Promise<T> {
    return this.call<T>('POST', `/__test/seed/${encodeURIComponent(scenario)}`, options);
  }

  readonly clock = {
    now: async (): Promise<number> => (await this.call<{ nowMs: number }>('GET', '/__test/clock')).nowMs,
    set: async (nowMs: number): Promise<number> =>
      (await this.call<{ nowMs: number }>('POST', '/__test/clock', { nowMs })).nowMs,
    advance: async (advanceMs: number): Promise<number> =>
      (await this.call<{ nowMs: number }>('POST', '/__test/clock', { advanceMs })).nowMs,
    followReal: async (): Promise<number> => (await this.call<{ nowMs: number }>('POST', '/__test/clock/real')).nowMs,
  };

  readonly tasks = {
    pending: async (): Promise<PendingTask[]> =>
      (await this.call<{ tasks: PendingTask[] }>('GET', '/__test/tasks')).tasks,
    runDue: async (): Promise<string[]> => (await this.call<{ ran: string[] }>('POST', '/__test/tasks/run-due')).ran,
  };

  /** Phase 6: the AI SDK mock model's script and call log (docs/testids/phase-6.md, "Test-only routes"). */
  readonly llm = {
    script: async (script: LlmScript): Promise<void> => {
      await this.call('POST', '/__test/llm', script);
    },
    release: async (): Promise<void> => {
      await this.call('POST', '/__test/llm/release', {});
    },
    calls: async (): Promise<LlmCall[]> => (await this.call<{ calls: LlmCall[] }>('GET', '/__test/llm/calls')).calls,
  };

  /** Phase 1 scenario: org C with one admin and nothing else (docs/testids/phase-1.md, "Test-only scenarios"). */
  async seedEmptyOrg(): Promise<{ orgId: string }> {
    return this.seedScenario<{ orgId: string }>('empty-org');
  }

  /** Phase 1 scenario: one graded, submitted attempt (42 of 50, 1 strike) by this student. */
  async seedStudentAttempts(
    orgId: string,
    studentId: string,
  ): Promise<{ seriesId: string; testId: string; attemptId: string }> {
    return this.seedScenario('student-attempts', { orgId, studentId });
  }

  /** Phase 2 scenario: the `Placement 2026` series (docs/testids/phase-2.md, "Test-only scenarios"). */
  async seedSeries(options: SeriesSeed): Promise<{ seriesId: string }> {
    return this.seedScenario<{ seriesId: string }>('authoring-series', { ...options });
  }

  /** Phase 2 scenario: a test (by default with the `basic` questions), in a new default series unless one is given. */
  async seedAuthoringTest(options: AuthoringTestSeed): Promise<AuthoringTestIds> {
    return this.seedScenario<AuthoringTestIds>('authoring-test', { ...options });
  }

  /** Phase 3 scenario: a published test ready to sit, its window relative to the clock (docs/testids/phase-3.md). */
  async seedExamTest(options: ExamTestSeed): Promise<ExamTestIds> {
    return this.seedScenario<ExamTestIds>('exam-test', { ...options });
  }

  /** Phase 4 scenario: registered students 21 to 20 + count, made like the base seed (docs/testids/phase-4.md). */
  async seedMoreStudents(orgId: string, count: number): Promise<{ studentIds: string[] }> {
    return this.seedScenario<{ studentIds: string[] }>('more-students', { orgId, count });
  }

  /** Phase 4 scenario: finished, graded attempts of a test written directly (no task queued, no board computed). */
  async seedGradedAttempts(orgId: string, testId: string, attempts: GradedAttemptSeed[]): Promise<string[]> {
    return (await this.seedScenario<{ attemptIds: string[] }>('graded-attempts', { orgId, testId, attempts }))
      .attemptIds;
  }
}

export interface GradedAttemptSeed {
  studentId: string;
  score: number;
  timeSec: number;
  status?: 'submitted' | 'auto_submitted' | 'terminated';
  /** Default: the test's window start + timeSec × 1000. */
  submittedAt?: number;
  strikesCount?: number;
  terminationReason?: string;
  correct?: number;
  incorrect?: number;
  unanswered?: number;
}

export interface ExamTestSeed {
  orgId: string;
  seriesId?: string;
  title?: string;
  company?: string;
  questions?: 'none' | 'basic' | 'sectioned';
  /** Window start in minutes after the clock's current time (default -2). */
  opensInMin?: number;
  /** Window length in minutes (default 60). */
  windowMin?: number;
  timingMode?: 'fixed' | 'flexible';
  /** Flexible windows only (default 60). */
  durationMin?: number;
  /** Merged over the scenario's own overrides (window, timing, proctoring hardware off, shuffling off). */
  overrides?: Record<string, unknown>;
  eligibility?: Partial<{ departmentIds: string[]; graduationYears: number[]; include: string[]; exclude: string[] }>;
  seriesEligibility?: Partial<{
    departmentIds: string[];
    graduationYears: number[];
    include: string[];
    exclude: string[];
  }>;
  seriesStatus?: 'draft' | 'active' | 'archived';
  sectionDraws?: Record<string, number>;
  testDraw?: number;
  /** Default true: approved and published (`scheduled`). */
  publish?: boolean;
}

export interface ExamTestIds extends AuthoringTestIds {
  window: { start: number; end: number };
}

export interface SeriesSeed {
  orgId: string;
  title?: string;
  status?: 'draft' | 'active' | 'archived';
  defaults?: Record<string, unknown>;
  eligibility?: Partial<{ departmentIds: string[]; graduationYears: number[]; include: string[]; exclude: string[] }>;
}

export interface AuthoringTestSeed {
  orgId: string;
  seriesId?: string;
  title?: string;
  company?: string;
  scheduledDate?: string;
  questions?: 'none' | 'basic' | 'sectioned';
  invalidQuestion?: boolean;
  overrides?: Record<string, unknown>;
  sectionDraws?: Record<string, number>;
  testDraw?: number;
  publish?: boolean;
}

export interface AuthoringTestIds {
  seriesId: string;
  testId: string;
  questionIds: string[];
  sectionIds: Record<string, string>;
}
