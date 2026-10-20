import { describe, expect, it } from 'vitest';
import {
  answerBatchSchema,
  attemptActionSchema,
  attemptEventReportSchema,
  attemptPayloadSchema,
  attemptResultSchema,
  attemptSubmitSchema,
  isFinishedAttempt,
} from './attempt';
import { SYSTEM_DEFAULTS } from './settings';

const now = 1_793_592_000_000;
const payload = {
  test: { id: 't1', title: 'Quantitative aptitude', dayLabel: 'Day 1' },
  durationMin: 60,
  sections: [],
  imageUrls: {},
  attempt: {
    id: 'a1',
    testId: 't1',
    status: 'in_progress',
    startedAt: now,
    deadlineAt: now + 3_600_000,
    strikesCount: 0,
    maxStrikes: 3,
  },
  questions: [
    {
      id: 'q1',
      sectionId: null,
      prompt: 'What is 2 + 2?',
      images: [],
      options: [
        { id: 'a', text: '4' },
        { id: 'b', text: '5' },
      ],
      correctOptionIds: ['a'],
      explanation: 'Two and two make four.',
    },
  ],
  settings: { ...SYSTEM_DEFAULTS, window: { start: now, end: now + 3_600_000 } },
  answers: { q1: { optionId: 'a', seq: 1 } },
  questionServedAt: {},
  serverTime: now,
};

describe('attempt schemas', () => {
  it('DATA-05 the attempt payload strips correctOptionIds and explanation from questions and settings', () => {
    const parsed = attemptPayloadSchema.parse(payload);
    const json = JSON.stringify(parsed);
    expect(json).not.toContain('correctOptionIds');
    expect(json).not.toContain('explanation');
    expect(json).not.toContain('Two and two make four.');
    expect(parsed.questions[0]).toMatchObject({ id: 'q1', sectionId: null, options: payload.questions[0]!.options });
    expect(parsed.settings).not.toHaveProperty('resultDetail');
  });

  it('EX-11 an answer batch needs seq, clientTs, backlog and clock offset, and refuses unknown keys', () => {
    const answer = { questionId: 'q1', optionId: null, seq: 1, clientTs: now };
    expect(answerBatchSchema.safeParse({ answers: [answer], backlog: 0, clockOffsetMs: -120 }).success).toBe(true);
    expect(
      answerBatchSchema.safeParse({ answers: [{ ...answer, seq: undefined }], backlog: 0, clockOffsetMs: 0 }).success,
    ).toBe(false);
    expect(
      answerBatchSchema.safeParse({ answers: [{ ...answer, score: 1 }], backlog: 0, clockOffsetMs: 0 }).success,
    ).toBe(false);
    expect(answerBatchSchema.safeParse({ answers: [answer] }).success).toBe(false);
  });

  it('PR-08 a browser cannot report the server-written late_sync or note events', () => {
    expect(attemptEventReportSchema.parse({ type: 'tab_hidden', clientTs: now })).toEqual({
      type: 'tab_hidden',
      clientTs: now,
      details: {},
    });
    expect(attemptEventReportSchema.safeParse({ type: 'late_sync', clientTs: now }).success).toBe(false);
    expect(attemptEventReportSchema.safeParse({ type: 'note', clientTs: now }).success).toBe(false);
  });

  it('PR-08 PR-11 event details are small: at most 20 keys, strings up to 500 characters, about 4 KB in all', () => {
    const ok = (details: unknown) => attemptEventReportSchema.safeParse({ type: 'tab_hidden', clientTs: now, details });
    expect(ok({ source: 'blur', faces: 2, hidden: true, gone: null }).success).toBe(true);
    expect(ok({ key: 'x'.repeat(500) }).success).toBe(true);
    expect(ok({ key: 'x'.repeat(501) }).success, 'a 501-character string').toBe(false);
    expect(ok({ blob: 'x'.repeat(900_000) }).success, 'a 900 KB string').toBe(false);
    expect(ok(Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))).success).toBe(true);
    expect(ok(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`k${i}`, i]))).success, '21 keys').toBe(false);
    expect(
      ok(Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`k${i}`, 'y'.repeat(450)]))).success,
      'over 4 KB in all',
    ).toBe(false);
    expect(ok({ nested: { deep: 'x'.repeat(5_000) } }).success, 'a nested value').toBe(false);
  });

  it('EX-16 a submit is {} or { reason: "time_up" }', () => {
    expect(attemptSubmitSchema.safeParse({}).success).toBe(true);
    expect(attemptSubmitSchema.safeParse({ reason: 'time_up' }).success).toBe(true);
    expect(attemptSubmitSchema.safeParse({ reason: 'other' }).success).toBe(false);
  });

  it('Q-09 the stored result holds the score, sections and time taken', () => {
    const section = { score: 0.75, max: 6, correct: 1, incorrect: 1, unanswered: 4 };
    const result = { ...section, pct: 12.5, passed: false, sections: { s1: section }, durationSec: 1800 };
    expect(attemptResultSchema.parse(result)).toEqual(result);
    expect(attemptResultSchema.safeParse({ ...result, durationSec: undefined }).success).toBe(false);
  });

  it('PR-10 submitted, auto-submitted and terminated attempts are finished', () => {
    expect(
      ['in_progress', 'submitted', 'auto_submitted', 'terminated', 'reset'].map((s) => isFinishedAttempt(s as never)),
    ).toEqual([false, true, true, true, false]);
  });

  it('OPS-04 OPS-10 terminate, reinstate and reset need a reason that is not blank, stored trimmed', () => {
    expect(attemptActionSchema.parse({ reason: '  Laptop crashed ' })).toEqual({ reason: 'Laptop crashed' });
    for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 'x'.repeat(501) }, { reason: 5 }])
      expect(attemptActionSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
  });
});
