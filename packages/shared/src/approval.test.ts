import { describe, expect, it } from 'vitest';
import { approvalChecklist, type ChecklistInput } from './approval';
import { totalMarks } from './marks';
import { resolveSettings, SYSTEM_DEFAULTS, type Settings } from './settings';

const settings = (over: Partial<Settings> = {}): Settings => ({
  ...SYSTEM_DEFAULTS,
  window: { start: 0, end: 60 * 60_000 },
  ...over,
});
const q = (id: string, extra: Partial<ChecklistInput['questions'][number]> = {}) => ({
  id,
  status: 'approved',
  ...extra,
});
const basic = [q('q1'), q('q2'), q('q3'), q('q4')];
const run = (input: Partial<ChecklistInput>) =>
  approvalChecklist({ test: { sections: [] }, questions: basic, settings: settings(), ...input });
const texts = (input: Partial<ChecklistInput>) => run(input).items.map((i) => i.text);

describe('approvalChecklist', () => {
  it('Q-14 a valid test passes all four items in order and computes the total marks', () => {
    const result = run({ settings: settings({ marking: { marks: 4, negativeMarks: 1, preset: 'p4_m1' } }) });
    expect(result.items.map((i) => i.text)).toEqual([
      'Passed: Every question is valid',
      'Passed: Every draw can be filled',
      'Passed: Total marks 16',
      'Passed: Settings are complete',
    ]);
    expect(result).toMatchObject({ passed: true, totalMarks: 16 });
  });

  it('Q-14 item 1 counts draft questions and fails a test with no questions', () => {
    expect(texts({ questions: [...basic, q('q5', { status: 'draft' })] })[0]).toBe(
      'Failed: 1 question needs attention',
    );
    expect(texts({ questions: [q('a', { status: 'draft' }), q('b', { status: 'draft' })] })[0]).toBe(
      'Failed: 2 questions need attention',
    );
    const empty = run({ questions: [] });
    expect(empty.items[0].text).toBe('Failed: The test has no questions');
    expect(empty.passed).toBe(false);
  });

  it('Q-14 item 2 lists every draw its pool cannot fill, by section name or The test', () => {
    const sections = [
      { id: 's1', name: 'Quant', drawCount: 5 },
      { id: 's2', name: 'Verbal', difficultyMix: { easy: 2, medium: 0, hard: 1 } },
    ];
    const questions = [
      ...['a', 'b', 'c', 'd'].map((id) => q(id, { sectionId: 's1' })),
      q('e', { sectionId: 's2', difficulty: 'easy' }),
      q('f', { sectionId: 's2', difficulty: 'easy' }),
      q('g', { sectionId: 's2', difficulty: 'medium' }),
    ];
    expect(texts({ test: { sections }, questions })[1]).toBe(
      'Failed: Quant draws 5 but has 4 approved questions; Verbal needs 1 hard question but has 0',
    );
    expect(texts({ test: { sections: [], drawCount: 6 } })[1]).toBe(
      'Failed: The test draws 6 but has 4 approved questions',
    );
    expect(texts({ test: { sections: [], drawCount: 2 } })).toContain('Passed: Every draw can be filled');
  });

  it('Q-14 Q-07 item 3 sums drawn counts times pool marks and fails a partial draw over uneven marks', () => {
    const sections = [{ id: 's1', name: 'Quant', marks: 2, drawCount: 2 }];
    const questions = [q('a', { sectionId: 's1' }), q('b', { sectionId: 's1' }), q('c', { sectionId: 's1' }), q('d')];
    // Quant draws 2 of 3 at 2 marks, the loose question is drawn in full at the test's 1 mark.
    expect(run({ test: { sections }, questions }).totalMarks).toBe(5);
    // A pool drawn in full may mix marks: its total is the same for everyone.
    expect(run({ questions: [q('a', { marks: 3 }), q('b')] }).items[2].text).toBe('Passed: Total marks 4');
    const uneven = run({
      test: { sections },
      questions: [...questions.slice(0, 2), q('c', { sectionId: 's1', marks: 5 })],
    });
    expect(uneven.items[2].text).toBe('Failed: Marks differ within Quant, so totals would differ between students');
    expect(uneven.passed).toBe(false);
  });

  it('Q-14 SER-09 item 4 fails settings that cannot run, the leaky full review on submit included', () => {
    expect(texts({ settings: settings({ window: null }) })[3]).toBe('Failed: The test has no window');
    expect(texts({ settings: settings({ timingMode: 'flexible', durationMin: 90 }) })[3]).toBe(
      'Failed: The window is shorter than the duration',
    );
    const leaky = run({
      settings: settings({ timingMode: 'flexible', resultDetail: 'full', resultRelease: 'immediate' }),
    });
    expect(leaky.items[3].text).toBe(
      'Failed: A full review released on submit would show the answers before the flexible window closes',
    );
    expect(leaky.passed).toBe(false);
    expect(texts({ settings: settings({ passingMarks: 5, questionTimeMode: 'same' }) })[3]).toBe(
      'Failed: The time limit per question is not set; The passing marks are above the total marks',
    );
  });

  it('Q-14 a resolved series daily window in fixed mode is complete', () => {
    const resolved = resolveSettings({
      series: { defaults: {}, dailyWindow: { startMinutes: 600, endMinutes: 660 } },
      test: { overrides: {}, scheduledDate: '2026-11-02' },
      timezone: 'Asia/Kolkata',
    });
    expect(run({ settings: resolved }).passed).toBe(true);
  });
});

describe('totalMarks', () => {
  it('Q-14 adds nothing for an uneven pool and reports it by section ID', () => {
    const pools = [{ sectionId: null, questions: [{ id: 'a' }, { id: 'b' }], drawCount: 1 }];
    expect(totalMarks(pools, [{ id: 'a', marks: 2 }, { id: 'b' }], [], { marks: 1, negativeMarks: 0 })).toEqual({
      total: 0,
      uneven: [null],
    });
    expect(totalMarks(pools, [{ id: 'a' }, { id: 'b' }], [], { marks: 3, negativeMarks: 0 })).toEqual({
      total: 3,
      uneven: [],
    });
  });
});
