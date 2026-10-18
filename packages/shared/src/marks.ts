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
