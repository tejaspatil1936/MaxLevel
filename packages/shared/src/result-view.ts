import type { AttemptRecord } from './attempt';
import { resolveMarks, type MarkLevel } from './marks';
import { manualReleaseRefusal, resultReleaseState, resultsPublic, type ReleaseInput } from './release';
import { OTHER_QUESTIONS, type ResultSection, type ReviewItem, type StudentResult } from './results';
import { NO_SECTION_KEY } from './scoring';
import type { Settings } from './settings';
import type { Section } from './test-record';

// The student's result as the API builds it from the attempt, the test's settings and release state (spec 8.1,
// docs/testids/phase-4.md "Result"). Only a released full review carries an answer key or explanation (DATA-05).
/** A question as the review reads it: prompt, options, answer key, explanation and its own marks. */
export interface ReviewQuestion extends MarkLevel {
  prompt: string;
  options: ReadonlyArray<{ id: string; text: string }>;
  correctOptionIds: string[];
  explanation?: string;
}

export interface StudentResultInput {
  attempt: Pick<
    AttemptRecord,
    'id' | 'testId' | 'studentId' | 'status' | 'terminationReason' | 'strikesCount' | 'result' | 'draw'
  >;
  test: {
    title: string;
    dayLabel: string | null;
    sections: ReadonlyArray<Pick<Section, 'id' | 'name' | 'order'> & MarkLevel>;
  };
  settings: Settings;
  release: Omit<ReleaseInput, 'settings'>;
  now: number;
  /**
   * The stored test board (LB-01), when the test leaderboard is on for students (`public_leaderboards` and the test's
   * `testLeaderboard`); `rows` is null while the board has not been computed. Absent means no rank line.
   */
  board?: { rows: ReadonlyArray<{ studentId: string; rank: number }> | null; total: number };
  /** Needed only when `resultDetailShown` is `full`: the questions and the student's answers. */
  review?: {
    questions: ReadonlyMap<string, ReviewQuestion>;
    answers: Readonly<Record<string, { optionId: string | null } | undefined>>;
  };
}

/**
 * The detail level shown for released results, or null when they are not released. A full review in a flexible window
 * that has not closed is shown as section scores: students who haven't started would see the answers (SER-09,
 * DATA-05). The settings form and Release results already refuse that combination; this holds whatever is stored.
 */
export function resultDetailShown(
  settings: Settings,
  release: Omit<ReleaseInput, 'settings'>,
  now: number,
): Settings['resultDetail'] | null {
  const input = { settings, ...release };
  if (resultReleaseState(input) !== 'released') return null;
  if (settings.resultDetail === 'full' && manualReleaseRefusal(input, now) === 'FULL_REVIEW_BEFORE_CLOSE')
    return 'sections';
  return settings.resultDetail;
}

const tidy = (n: number) => Math.round(n * 1e6) / 1e6 + 0;

/** RES-02: section scores in section order, then `Other questions`; a test without sections has none. */
function sectionScores(input: StudentResultInput): ResultSection[] {
  const stored = input.attempt.result?.sections ?? {};
  if (!input.test.sections.length) return [];
  const zero = { score: 0, max: 0, correct: 0, incorrect: 0, unanswered: 0 };
  const rows: ResultSection[] = [...input.test.sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ sectionId: s.id, name: s.name, ...zero, ...stored[s.id] }));
  if (stored[NO_SECTION_KEY]) rows.push({ sectionId: null, name: OTHER_QUESTIONS, ...stored[NO_SECTION_KEY] });
  return rows;
}

/** RES-03, SER-10: every drawn question in exam order, with the marks gained or lost as grading counted them. */
function reviewItems(input: StudentResultInput): ReviewItem[] {
  const { attempt, review, settings } = input;
  if (!review) return [];
  const sectionOf = new Map(attempt.draw.sections.flatMap((s) => s.questionIds.map((q) => [q, s.sectionId])));
  const sections = new Map(input.test.sections.map((s) => [s.id, s]));
  return attempt.draw.questionIds.flatMap((questionId) => {
    const q = review.questions.get(questionId);
    if (!q) return [];
    const sectionId = sectionOf.get(questionId) ?? null;
    const byId = new Map(q.options.map((o) => [o.id, o]));
    const chosenOptionId = review.answers[questionId]?.optionId ?? null;
    const m = resolveMarks(q, sectionId === null ? undefined : sections.get(sectionId), settings.marking);
    const marks =
      chosenOptionId === null ? 0 : q.correctOptionIds.includes(chosenOptionId) ? m.marks : -m.negativeMarks;
    return [
      {
        questionId,
        sectionId,
        prompt: q.prompt,
        options: (attempt.draw.optionOrder[questionId] ?? []).flatMap((o) => {
          const option = byId.get(o);
          return option ? [{ id: option.id, text: option.text }] : [];
        }),
        chosenOptionId,
        correctOptionIds: [...q.correctOptionIds],
        marks: tidy(marks),
        ...(q.explanation ? { explanation: q.explanation } : {}),
      },
    ];
  });
}

/**
 * RES-02, LB-04, PR-10: the rank from the stored test board once the board is open (results public), with the number of
 * ranked rows; a note instead for a terminated attempt (never ranked) or while a flexible window is still open.
 */
function rankLine(input: StudentResultInput): Pick<StudentResult, 'rank' | 'rankNote'> {
  const { attempt, board, settings, release, now } = input;
  if (!board) return {};
  if (attempt.status === 'terminated') return { rankNote: 'not_ranked' };
  if (!resultsPublic({ settings, ...release }, now)) return { rankNote: 'after_close' };
  const row = board.rows?.find((r) => r.studentId === attempt.studentId);
  return row ? { rank: { rank: row.rank, total: board.total } } : {};
}

/** The student's result as the API serves it (RES-01 to RES-03, RES-05, RES-06, DATA-05). */
export function studentResult(input: StudentResultInput): StudentResult {
  const { attempt, test, settings, release, now } = input;
  const state = resultReleaseState({ settings, ...release });
  const base: StudentResult = {
    attemptId: attempt.id,
    testId: attempt.testId,
    title: test.title,
    dayLabel: test.dayLabel,
    status: attempt.status as StudentResult['status'],
    ...(attempt.terminationReason ? { terminationReason: attempt.terminationReason } : {}),
    strikesCount: attempt.strikesCount,
    maxStrikes: settings.maxStrikes,
    resultRelease: settings.resultRelease,
    windowEnd: settings.window?.end ?? null,
    release: state,
  };
  const detail = resultDetailShown(settings, release, now);
  const result = attempt.result;
  if (!detail || !result) return base;
  return {
    ...base,
    detail,
    score: result.score,
    max: result.max,
    pct: result.pct,
    durationSec: result.durationSec,
    ...rankLine(input),
    ...(detail !== 'score' ? { sections: sectionScores(input) } : {}),
    ...(detail === 'full' ? { review: reviewItems(input) } : {}),
  };
}
