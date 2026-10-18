import type { Section } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import {
  drawText,
  durationText,
  mixText,
  sectionDraft,
  sectionErrors,
  sectionFromDraft,
  serverFieldError,
  testDrawError,
  type SectionDraft,
} from './section-draft';

const quant: Section = {
  id: 's1',
  name: 'Quant',
  order: 1,
  instructions: 'Answer every question.',
  durationMin: 20,
  forwardOnly: true,
};
/** 3 easy, 2 medium, 1 hard. */
const pool = [
  ...['e1', 'e2', 'e3'].map((id) => ({ id, difficulty: 'easy' as const })),
  ...['m1', 'm2'].map((id) => ({ id, difficulty: 'medium' as const })),
  { id: 'h1', difficulty: 'hard' as const },
];
const draft = (patch: Partial<SectionDraft>): SectionDraft => ({ ...sectionDraft(quant), ...patch });
const mix = (easy: string, medium: string, hard: string) => ({ mix: { easy, medium, hard } });

describe('section dialog draft', () => {
  it('Q-03 a stored section round-trips, empty fields are left out and the place sets id and order', () => {
    expect(sectionFromDraft(sectionDraft(quant), { id: 's1', order: 2 })).toEqual({ ...quant, order: 2 });
    expect(sectionFromDraft(sectionDraft(), { order: 1 })).toEqual({ name: '', order: 1, forwardOnly: false });
    expect(sectionFromDraft(draft({ instructions: '  ', ...mix('2', '', '1') }), { order: 1 })).toMatchObject({
      difficultyMix: { easy: 2, medium: 0, hard: 1 },
    });
    expect(sectionFromDraft(draft(mix('0', '0', '')), { order: 1 })).not.toHaveProperty('difficultyMix');
  });

  it('Q-03 an empty name and badly formed numbers are refused on their fields', () => {
    expect(sectionErrors(draft({ name: ' ', durationMin: '0', drawCount: '1.5', marks: '0' }), pool)).toEqual({
      name: 'Enter the section name.',
      durationMin: 'Enter a whole number of minutes, 1 or more.',
      drawCount: 'Enter a whole number of questions, 1 or more.',
      marks: 'Enter a number greater than 0.',
    });
    expect(sectionErrors(draft({ ...mix('-1', '', ''), negativeMarks: '-1' }), pool)).toEqual({
      easy: 'Enter a whole number, 0 or more.',
      negativeMarks: 'Enter 0 or a positive number.',
    });
  });

  it('US-AD-07 Q-05 a draw or mix the pool cannot satisfy is refused with the contract texts', () => {
    expect(sectionErrors(draft({ drawCount: '7' }), pool)).toEqual({
      drawCount: "This section has 6 approved questions, so it can't draw 7.",
    });
    expect(sectionErrors(draft({ drawCount: '1' }), [])).toEqual({
      drawCount: "This section has 0 approved questions, so it can't draw 1.",
    });
    expect(sectionErrors(draft(mix('2', '3', '2')), pool)).toEqual({
      medium: "This section has 2 medium questions, so the mix can't take 3.",
      hard: "This section has 1 hard question, so the mix can't take 2.",
    });
    expect(sectionErrors(draft({ drawCount: '4', ...mix('2', '2', '1') }), pool)).toEqual({
      drawCount: 'The mix adds up to 5 questions. Set Questions to draw to 5 or leave it empty.',
    });
    expect(sectionErrors(draft({ drawCount: '5', ...mix('2', '2', '1') }), pool)).toEqual({});
  });

  it('US-AD-07 a refused PATCH is shown on the field it names', () => {
    const err = (field: string) => new ApiError(400, 'MIX_UNSATISFIABLE', 'Too many.', { field });
    expect(serverFieldError(err('difficultyMix.hard'))).toEqual({ hard: 'Too many.' });
    expect(serverFieldError(err('drawCount'))).toEqual({ drawCount: 'Too many.' });
    expect(serverFieldError(err('resultRelease'))).toBeNull();
  });

  it('US-AD-07 the whole-test draw is empty for all, or a whole number up to the approved questions', () => {
    expect(testDrawError('', 4)).toBeUndefined();
    expect(testDrawError('4', 4)).toBeUndefined();
    expect(testDrawError('8', 4)).toBe("This test has 4 approved questions, so it can't draw 8.");
    expect(testDrawError('2', 1)).toBe("This test has 1 approved question, so it can't draw 2.");
    expect(testDrawError('0', 4)).toBe('Enter a whole number of questions, 1 or more.');
  });
});

describe('sections table', () => {
  it('Q-03 Q-05 cells read All or the draw, None or the mix, the test timer or minutes', () => {
    expect([drawText(quant), mixText(quant), durationText(quant)]).toEqual(['All', 'None', '20 minutes']);
    const mixed: Section = { ...quant, difficultyMix: { easy: 2, medium: 2, hard: 1 } };
    expect([drawText(mixed), mixText(mixed)]).toEqual(['5', '2 easy, 2 medium, 1 hard']);
    const { durationMin: _d, ...untimed } = quant;
    expect([drawText({ ...quant, drawCount: 3 }), durationText(untimed)]).toEqual(['3', 'Test timer']);
  });
});
