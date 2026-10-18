import { SYSTEM_DEFAULTS, type Settings } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { choosePreset, editValue, markingDraft, markingErrors, markingOverrides } from './marking-draft';

const series: Settings = { ...SYSTEM_DEFAULTS, window: null };
const initial = markingDraft(series);

describe('marking and timers draft', () => {
  it('Q-08 a new test shows +1 and 0 with no time limit', () => {
    expect(initial).toEqual({ preset: 'p1_0', marks: '1', negativeMarks: '0', timeMode: 'none', seconds: '' });
  });

  it('Q-08 a preset fills both values, an edit that matches no preset is Custom, and Custom keeps the values', () => {
    const four = choosePreset(initial, 'p4_m1');
    expect(four).toMatchObject({ preset: 'p4_m1', marks: '4', negativeMarks: '1' });
    expect(choosePreset(initial, 'p1_m025')).toMatchObject({ marks: '1', negativeMarks: '0.25' });
    const edited = editValue(four, 'marks', '5');
    expect(edited).toMatchObject({ preset: 'custom', marks: '5', negativeMarks: '1' });
    expect(editValue(edited, 'marks', '4').preset).toBe('p4_m1');
    expect(editValue(four, 'marks', '').preset).toBe('custom');
    expect(choosePreset(four, 'custom')).toMatchObject({ preset: 'custom', marks: '4', negativeMarks: '1' });
  });

  it('Q-08 Q-10 marks of 0, a negative deduction and seconds that are not a whole number of 1 or more are refused', () => {
    expect(markingErrors({ ...initial, marks: '0', negativeMarks: '-1' })).toEqual({
      marks: 'marking.marksInvalid',
      negativeMarks: 'marking.negativeInvalid',
    });
    expect(markingErrors({ ...initial, timeMode: 'same', seconds: '0' })).toEqual({
      seconds: 'marking.secondsInvalid',
    });
    expect(markingErrors({ ...initial, timeMode: 'same', seconds: '1.5' }).seconds).toBe('marking.secondsInvalid');
    expect(markingErrors({ ...initial, timeMode: 'same', seconds: '4000' }).seconds).toBe('marking.secondsTooLarge');
    expect(markingErrors({ ...initial, timeMode: 'each', seconds: '' })).toEqual({});
  });

  it('Q-08 Q-10 saving keeps the overrides other tabs own and stores seconds only for the same limit', () => {
    const stored = { maxStrikes: 2, questionTimeLimitSec: 90, questionTimeMode: 'same' as const };
    expect(markingOverrides(choosePreset(initial, 'p4_m1'), stored, series)).toEqual({
      maxStrikes: 2,
      marking: { marks: 4, negativeMarks: 1, preset: 'p4_m1' },
      questionTimeMode: 'none',
    });
    expect(markingOverrides({ ...initial, timeMode: 'same', seconds: '90' }, {}, series)).toEqual({
      questionTimeMode: 'same',
      questionTimeLimitSec: 90,
    });
    expect(markingOverrides({ ...initial, timeMode: 'each', seconds: '90' }, {}, series)).toEqual({
      questionTimeMode: 'each',
    });
  });

  it('Q-08 values equal to the series are not stored unless the test already overrode them', () => {
    expect(markingOverrides(initial, { shuffleOptions: false }, series)).toEqual({ shuffleOptions: false });
    const own = { marking: { marks: 1, negativeMarks: 0, preset: 'p1_0' as const } };
    expect(markingOverrides(initial, own, series)).toEqual(own);
  });
});
