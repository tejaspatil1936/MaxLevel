// Scoring (spec 6.5, Q-07, Q-09; result shape spec 8.1). Grading passes the stored draw's questions with their
// resolved marks (resolveMarks) and the answer key; the client's view is never read (EX-17).

/** A question as scoring sees it: its answer key and resolved marks (negativeMarks is the positive deduction). */
export interface ScoringQuestion {
  id: string;
  sectionId: string | null;
  correctOptionIds: string[];
  marks: number;
  negativeMarks: number;
}

export interface SectionScore {
  score: number;
  max: number;
  correct: number;
  incorrect: number;
  unanswered: number;
}

export interface AttemptScore extends SectionScore {
  pct: number;
  passed?: boolean;
  sections: Record<string, SectionScore>;
}

/** The `sections` key for questions in no section (Firestore map keys cannot be empty). */
export const NO_SECTION_KEY = 'none';

/** Rounds away floating-point noise from fractional marks (0.1 + 0.2), to 6 decimal places. */
const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

const empty = (): SectionScore => ({ score: 0, max: 0, correct: 0, incorrect: 0, unanswered: 0 });

/**
 * One attempt's score (Q-09): a correct answer adds the question's marks, a wrong one takes off its negative marks,
 * an unanswered one (missing or `optionId: null`) scores 0. `pct` is score / max × 100 (0 when max is 0). `passed`
 * is set only with `passingMarks` (score >= passingMarks). With `floorAtZero` (off by default) a negative total is
 * shown as 0; section scores are never floored.
 */
export function scoreAttempt(input: {
  questions: ReadonlyArray<ScoringQuestion>;
  answers: Readonly<Record<string, { optionId: string | null } | undefined>>;
  passingMarks?: number;
  floorAtZero?: boolean;
}): AttemptScore {
  const total = empty();
  const sections: Record<string, SectionScore> = {};
  for (const q of input.questions) {
    const section = (sections[q.sectionId ?? NO_SECTION_KEY] ??= empty());
    const optionId = input.answers[q.id]?.optionId ?? null;
    const outcome = optionId === null ? 'unanswered' : q.correctOptionIds.includes(optionId) ? 'correct' : 'incorrect';
    const points = outcome === 'correct' ? q.marks : outcome === 'incorrect' ? -q.negativeMarks : 0;
    for (const s of [total, section]) {
      s.score += points;
      s.max += q.marks;
      s[outcome] += 1;
    }
  }
  for (const s of Object.values(sections)) {
    s.score = tidy(s.score);
    s.max = tidy(s.max);
  }
  const max = tidy(total.max);
  const raw = tidy(total.score);
  const score = input.floorAtZero && raw < 0 ? 0 : raw;
  return {
    ...total,
    score,
    max,
    pct: max > 0 ? tidy((score / max) * 100) : 0,
    ...(input.passingMarks !== undefined ? { passed: score >= input.passingMarks } : {}),
    sections,
  };
}
