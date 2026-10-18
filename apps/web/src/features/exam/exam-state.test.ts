import { describe, expect, it } from 'vitest';
import { examReducer, initialExamState, questionState, shortcutFor, type ExamAction } from './exam-state';

const ids = ['q1', 'q2', 'q3'];
const run = (...actions: ExamAction[]) => actions.reduce(examReducer(ids), initialExamState(ids));

describe('exam state', () => {
  it('EX-07 the first question starts visited and the rest not visited', () => {
    const s = initialExamState(ids);
    expect(ids.map((id) => questionState(s, id))).toEqual(['notAnswered', 'notVisited', 'notVisited']);
  });

  it('EX-08 Q-13 answers are kept per question while moving between questions', () => {
    const s = run(
      { type: 'choose', optionId: 'a' },
      { type: 'choose', optionId: 'b' },
      { type: 'goTo', index: 1 },
      { type: 'goTo', index: 0 },
    );
    expect(s.index).toBe(0);
    expect(s.answers).toEqual({ q1: 'b' });
    expect(questionState(s, 'q2')).toBe('notAnswered');
  });

  it('EX-07 EX-08 clear and mark for review give every palette state', () => {
    const s = run(
      { type: 'choose', optionId: 'a' },
      { type: 'toggleMark' },
      { type: 'goTo', index: 1 },
      { type: 'toggleMark' },
      { type: 'choose', optionId: 'c' },
      { type: 'clear' },
    );
    expect(ids.map((id) => questionState(s, id))).toEqual(['answeredMarked', 'marked', 'notVisited']);
    const unmarked = [{ type: 'toggleMark' } as const].reduce(examReducer(ids), s);
    expect(questionState(unmarked, 'q2')).toBe('notAnswered');
  });

  it('EX-08 moving past either end does nothing', () => {
    expect(run({ type: 'goTo', index: 3 }).index).toBe(0);
    expect(run({ type: 'goTo', index: -1 }).index).toBe(0);
  });

  it('EX-05 resuming starts from the saved answers and marks, and saved questions count as visited', () => {
    const s = initialExamState(ids, {
      q2: { optionId: 'b', markedForReview: true },
      q3: { optionId: null, markedForReview: true },
      gone: { optionId: 'a' },
    });
    expect(s.index).toBe(0);
    expect(ids.map((id) => questionState(s, id))).toEqual(['notAnswered', 'answeredMarked', 'marked']);
    expect(s.answers).toEqual({ q2: 'b' });
  });

  it('EX-07 a locked question shows locked, answered or not, and takes no more changes', () => {
    const s = { ...run({ type: 'choose', optionId: 'a' }), locked: { q1: true as const } };
    expect(questionState(s, 'q1')).toBe('lockedAnswered');
    expect(questionState({ ...s, answers: {} }, 'q1')).toBe('lockedNotAnswered');
    const reduce = examReducer(ids);
    for (const action of [{ type: 'clear' }, { type: 'toggleMark' }, { type: 'choose', optionId: 'b' }] as const)
      expect(reduce(s, action)).toBe(s);
  });

  it('EX-08 choosing the chosen option or clearing an empty answer changes nothing', () => {
    const s = run({ type: 'choose', optionId: 'a' });
    const reduce = examReducer(ids);
    expect(reduce(s, { type: 'choose', optionId: 'a' })).toBe(s);
    const cleared = reduce(s, { type: 'clear' });
    expect(reduce(cleared, { type: 'clear' })).toBe(cleared);
  });
});

describe('exam shortcuts', () => {
  const key = (k: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; metaKey: boolean }> = {}) =>
    shortcutFor({ key: k, ctrlKey: false, altKey: false, metaKey: false, ...mods });

  it('EX-09 A11Y-06 numbers and letters choose options, N P M T move, mark and tell the time, ? lists them', () => {
    expect(['1', '6', 'a', 'F', 'c'].map((k) => key(k))).toEqual([
      { type: 'option', index: 0 },
      { type: 'option', index: 5 },
      { type: 'option', index: 0 },
      { type: 'option', index: 5 },
      { type: 'option', index: 2 },
    ]);
    expect(['n', 'P', 'm', 'T', '?'].map((k) => key(k)?.type)).toEqual(['next', 'previous', 'mark', 'time', 'help']);
  });

  it('EX-09 other keys and any key with Ctrl, Alt or Meta are left alone', () => {
    expect(['7', 'g', 'Enter', ' ', 'Escape', 'ArrowDown'].map((k) => key(k))).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(key('c', { ctrlKey: true })).toBeNull();
    expect(key('p', { metaKey: true })).toBeNull();
    expect(key('1', { altKey: true })).toBeNull();
  });
});
