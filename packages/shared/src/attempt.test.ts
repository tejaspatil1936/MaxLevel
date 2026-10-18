import { describe, expect, it } from 'vitest';
import {
  answerBatchSchema,
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
});
