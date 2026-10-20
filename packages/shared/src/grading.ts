import type { AttemptRecord, AttemptResult } from './attempt';
import { resolveMarks, type MarkLevel } from './marks';
import { scoreAttempt, type ScoringQuestion } from './scoring';
import type { Settings } from './settings';

// Grading (EX-17, Q-06, spec 8.1): the same function in the API (submit, strikes) and the worker (auto-submit), so a
// result never depends on who finalized the attempt. It reads the attempt's stored draw and the answer key, never the
// client's view of the exam.

/** A question as grading reads it from the test's question records: its answer key and its own marks. */
export interface GradingQuestion extends MarkLevel {
  correctOptionIds: string[];
}

export interface GradeInput {
  /** The stored draw decides which questions count and which section each one is in. */
  attempt: Pick<AttemptRecord, 'draw' | 'startedAt' | 'deadlineAt'>;
  /** Answer keys by question ID. A drawn question missing here counts with no correct option. */
  questions: ReadonlyMap<string, GradingQuestion>;
  /** The test's sections, for section-level marks (Q-07). */
  sections: ReadonlyArray<{ id: string } & MarkLevel>;
  settings: Pick<Settings, 'marking' | 'passingMarks' | 'floorAtZero'>;
  answers: Readonly<Record<string, { optionId: string | null } | undefined>>;
  submittedAt: number;
}

/**
 * The graded result saved on the attempt: `scoreAttempt` over the drawn questions with their resolved marks
 * (question, then section, then test), plus the time taken in whole seconds, from the start to the submission but
 * never past the deadline (an auto-submit runs after the late sync grace).
 */
export function gradeAttempt(input: GradeInput): AttemptResult {
  const { attempt, settings } = input;
  const sectionOf = new Map(attempt.draw.sections.flatMap((s) => s.questionIds.map((id) => [id, s.sectionId])));
  const sections = new Map(input.sections.map((s) => [s.id, s]));
  const questions: ScoringQuestion[] = attempt.draw.questionIds.map((id) => {
    const q = input.questions.get(id);
    const sectionId = sectionOf.get(id) ?? null;
    return {
      id,
      sectionId,
      correctOptionIds: q?.correctOptionIds ?? [],
      ...resolveMarks(q ?? {}, sectionId === null ? undefined : sections.get(sectionId), settings.marking),
    };
  });
  const score = scoreAttempt({
    questions,
    answers: input.answers,
    floorAtZero: settings.floorAtZero,
    ...(settings.passingMarks !== undefined ? { passingMarks: settings.passingMarks } : {}),
  });
  const end = Math.min(input.submittedAt, attempt.deadlineAt);
  return { ...score, durationSec: Math.max(0, Math.floor((end - attempt.startedAt) / 1000)) };
}
