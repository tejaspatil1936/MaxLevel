import { describe, expect, it } from 'vitest';
import { MARKING_PRESETS, presetFor, resolveMarks } from './marks';

const test = { marks: 1, negativeMarks: 0.25 };

describe('resolveMarks', () => {
  it('Q-07 marks come from the question, else the section, else the test', () => {
    expect(resolveMarks({ marks: 3 }, { marks: 2 }, test).marks).toBe(3);
    expect(resolveMarks({}, { marks: 2 }, test).marks).toBe(2);
    expect(resolveMarks({}, {}, test).marks).toBe(1);
    expect(resolveMarks({}, undefined, test).marks).toBe(1);
  });

  it('Q-07 negative marks resolve the same way, independently of marks', () => {
    expect(resolveMarks({ marks: 4 }, { negativeMarks: 1 }, test)).toEqual({ marks: 4, negativeMarks: 1 });
    expect(resolveMarks({ negativeMarks: 0.5 }, { marks: 2 }, test)).toEqual({ marks: 2, negativeMarks: 0.5 });
    expect(resolveMarks({}, { marks: 2 }, test)).toEqual({ marks: 2, negativeMarks: 0.25 });
  });

  it('Q-07 0 at a level is a value that overrides the lower levels, undefined falls through', () => {
    expect(resolveMarks({ negativeMarks: 0 }, { negativeMarks: 1 }, test).negativeMarks).toBe(0);
    expect(resolveMarks({}, { negativeMarks: 0 }, test).negativeMarks).toBe(0);
    expect(resolveMarks({ marks: 0 }, { marks: 2 }, test).marks).toBe(0);
    expect(resolveMarks({ marks: undefined }, { marks: undefined }, test)).toEqual(test);
  });
});

describe('presetFor', () => {
  it('Q-07 Q-08 maps 1/0, 1/0.25 and 4/1 to their presets', () => {
    expect(presetFor(1, 0)).toBe('p1_0');
    expect(presetFor(1, 0.25)).toBe('p1_m025');
    expect(presetFor(4, 1)).toBe('p4_m1');
    for (const [id, p] of Object.entries(MARKING_PRESETS)) expect(presetFor(p.marks, p.negativeMarks)).toBe(id);
  });

  it('Q-07 Q-08 maps anything else to custom', () => {
    expect(presetFor(2, 0)).toBe('custom');
    expect(presetFor(4, 0.25)).toBe('custom');
    expect(presetFor(1, 1)).toBe('custom');
  });
});
