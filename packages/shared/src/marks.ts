import { drawSize, type DrawPool } from './draw';

// Marks (spec 6.5, Q-07, Q-08). negativeMarks is the positive number taken off for a wrong answer (1 for −1).

export interface MarkLevel {
  marks?: number;
  negativeMarks?: number;
}

/**
 * Marks and negative marks each resolve on their own: question, then section, then test (Q-07). A level that sets
 * 0 overrides the levels below it; only `undefined` falls through.
 */
export function resolveMarks(
  question: MarkLevel,
  section: MarkLevel | undefined,
  test: { marks: number; negativeMarks: number },
): { marks: number; negativeMarks: number } {
  return {
    marks: question.marks ?? section?.marks ?? test.marks,
    negativeMarks: question.negativeMarks ?? section?.negativeMarks ?? test.negativeMarks,
  };
}

export const MARKING_PRESETS = {
  p1_0: { marks: 1, negativeMarks: 0 },
  p1_m025: { marks: 1, negativeMarks: 0.25 },
  p4_m1: { marks: 4, negativeMarks: 1 },
} as const satisfies Record<string, { marks: number; negativeMarks: number }>;

export type MarkingPreset = keyof typeof MARKING_PRESETS | 'custom';
export const MARKING_PRESET_IDS = ['p1_0', 'p1_m025', 'p4_m1', 'custom'] as const;

/** The preset whose values these are, else `custom` (a preset only fills in values that stay editable, Q-08). */
export function presetFor(marks: number, negativeMarks: number): MarkingPreset {
  for (const [id, p] of Object.entries(MARKING_PRESETS) as Array<[keyof typeof MARKING_PRESETS, MarkLevel]>) {
    if (p.marks === marks && p.negativeMarks === negativeMarks) return id;
  }
  return 'custom';
}

/** What totalMarks reads from a pool's questions and sections: an ID and the marks set at that level. */
type Marked = { id: string } & MarkLevel;

/**
 * The marks every student can score (Q-14): per pool, the drawn count times the pool's marks (question, then section,
 * then test marks). A pool drawn in full adds up its questions' marks. A pool that draws fewer than it holds while its
 * questions carry different marks would give students different totals: it is listed in `uneven` and adds nothing.
 */
export function totalMarks(
  pools: ReadonlyArray<DrawPool>,
  questions: ReadonlyArray<Marked>,
  sections: ReadonlyArray<Marked>,
  test: { marks: number; negativeMarks: number },
): { total: number; uneven: Array<string | null> } {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const uneven: Array<string | null> = [];
  let total = 0;
  for (const pool of pools) {
    const section = sections.find((s) => s.id === pool.sectionId);
    const marks = pool.questions.map((q) => resolveMarks(byId.get(q.id) ?? {}, section, test).marks);
    const drawn = Math.min(drawSize(pool), marks.length);
    if (drawn === marks.length) total += marks.reduce((a, b) => a + b, 0);
    else if (marks.every((m) => m === marks[0])) total += drawn * (marks[0] ?? 0);
    else uneven.push(pool.sectionId);
  }
  return { total, uneven };
}
