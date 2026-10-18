import { describe, expect, it } from 'vitest';
import { examReducer, initialExamState, questionState, type ExamAction } from './exam-state';

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
});
