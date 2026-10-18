import { drawProblems, testDrawPools, type Difficulty, type DrawProblem } from './draw';
import { totalMarks } from './marks';
import { settingsProblems, type Settings } from './settings';

// The approval checklist (Q-14, DECISIONS Q15): the Preview tab shows it and POST /v1/tests/{id}/approve runs it.

export type ChecklistKey = 'questions' | 'draws' | 'marks' | 'settings';
export interface ChecklistItem {
  key: ChecklistKey;
  passed: boolean;
  /** Exactly as shown: `Passed: …` or `Failed: …` (docs/testids/phase-2.md, Preview tab). */
  text: string;
}
export interface Checklist {
  items: [ChecklistItem, ChecklistItem, ChecklistItem, ChecklistItem];
  passed: boolean;
  totalMarks: number;
}

export interface ChecklistInput {
  test: {
    sections: ReadonlyArray<{
      id: string;
      name: string;
      drawCount?: number;
      difficultyMix?: { easy: number; medium: number; hard: number };
      marks?: number;
      negativeMarks?: number;
    }>;
    drawCount?: number;
  };
  /** Every question of the test, drafts included. */
  questions: ReadonlyArray<{
    id: string;
    status: string;
    sectionId?: string | null;
    difficulty?: Difficulty;
    marks?: number;
    negativeMarks?: number;
  }>;
  /** The settings resolved for the test now. */
  settings: Settings;
}

const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

function drawText(p: DrawProblem, pool: string): string {
  if (p.code === 'DRAW_TOO_LARGE')
    return `${pool} draws ${p.drawCount} but has ${plural(p.available, 'approved question')}`;
  if (p.code === 'MIX_UNSATISFIABLE')
    return `${pool} needs ${plural(p.wanted, `${p.difficulty} question`)} but has ${p.available}`;
  return `${pool} draws ${p.drawCount} but its mix adds up to ${p.mixTotal}`;
}

/** What keeps the resolved settings from running a test (item 4), in a fixed order. */
export function settingsGaps(settings: Settings, total: number): string[] {
  const gaps: string[] = [];
  const w = settings.window;
  if (!w) gaps.push('The test has no window');
  else if (settings.timingMode === 'flexible' && (w.end - w.start) / 60_000 < settings.durationMin)
    gaps.push('The window is shorter than the duration');
  if (settingsProblems(settings).length)
    gaps.push('A full review released on submit would show the answers before the flexible window closes');
  if (settings.questionTimeMode === 'same' && settings.questionTimeLimitSec === undefined)
    gaps.push('The time limit per question is not set');
  if (settings.passingMarks !== undefined && settings.passingMarks > total)
    gaps.push('The passing marks are above the total marks');
  return gaps;
}

const item = (key: ChecklistKey, failures: string[], passed: string): ChecklistItem =>
  failures.length
    ? { key, passed: false, text: `Failed: ${failures.join('; ')}` }
    : { key, passed: true, text: `Passed: ${passed}` };

/**
 * Q-14: every question valid, every draw satisfiable, total marks computed, settings complete. Approval needs all
 * four to pass; the total is what approval stores as `totalMarks`.
 */
export function approvalChecklist({ test, questions, settings }: ChecklistInput): Checklist {
  const drafts = questions.filter((q) => q.status !== 'approved').length;
  const questionFailures =
    questions.length === 0
      ? ['The test has no questions']
      : drafts
        ? [`${plural(drafts, 'question')} ${drafts === 1 ? 'needs' : 'need'} attention`]
        : [];
  const pools = testDrawPools(test, questions);
  const poolName = (sectionId: string | null) => test.sections.find((s) => s.id === sectionId)?.name ?? 'The test';
  const drawFailures = pools.flatMap((pool) => drawProblems(pool).map((p) => drawText(p, poolName(pool.sectionId))));
  const marks = totalMarks(pools, questions, test.sections, settings.marking);
  const markFailures = marks.uneven.map(
    (sectionId) => `Marks differ within ${poolName(sectionId)}, so totals would differ between students`,
  );
  const items: Checklist['items'] = [
    item('questions', questionFailures, 'Every question is valid'),
    item('draws', drawFailures, 'Every draw can be filled'),
    item('marks', markFailures, `Total marks ${marks.total}`),
    item('settings', settingsGaps(settings, marks.total), 'Settings are complete'),
  ];
  return { items, passed: items.every((i) => i.passed), totalMarks: marks.total };
}
