// The exam screen's working state (EX-07, EX-08): where the student is, their answers and marks for review. The preview
// keeps it in memory only (Q-13); the attempt mode starts from the saved answers and syncs every change.

export interface ExamState {
  /** Index of the question shown, in exam order. */
  index: number;
  answers: Readonly<Record<string, string>>;
  marked: Readonly<Record<string, true>>;
  visited: Readonly<Record<string, true>>;
  /** Questions whose own timer ran out (Q-11); they can't be changed or opened again. */
  locked: Readonly<Record<string, true>>;
}

export type ExamAction =
  { type: 'choose'; optionId: string } | { type: 'clear' } | { type: 'toggleMark' } | { type: 'goTo'; index: number };

/** The palette states of EX-07; the locked ones come from per-question timers. */
export type QuestionState =
  'notVisited' | 'notAnswered' | 'answered' | 'marked' | 'answeredMarked' | 'lockedAnswered' | 'lockedNotAnswered';

/** A saved answer as the attempt payload returns it (EX-05). */
export interface SavedAnswer {
  optionId: string | null;
  markedForReview?: boolean;
}

/**
 * The state the exam opens in: question 1, which counts as visited (EX-07), plus, on resume, every saved answer and
 * mark; a question with a saved record was seen before, so it counts as visited too (EX-05).
 */
export function initialExamState(
  questionIds: readonly string[],
  saved: Readonly<Record<string, SavedAnswer>> = {},
): ExamState {
  const known = new Set(questionIds);
  const answers: Record<string, string> = {};
  const marked: Record<string, true> = {};
  const visited: Record<string, true> = {};
  if (questionIds[0]) visited[questionIds[0]] = true;
  for (const [id, a] of Object.entries(saved)) {
    if (!known.has(id)) continue;
    visited[id] = true;
    if (a.optionId) answers[id] = a.optionId;
    if (a.markedForReview) marked[id] = true;
  }
  return { index: 0, answers, marked, visited, locked: {} };
}

const without = <T>(map: Readonly<Record<string, T>>, key: string) => {
  const { [key]: _gone, ...rest } = map;
  return rest;
};

/** A reducer over the questions in exam order; actions on the current question act on `index`. */
export function examReducer(questionIds: readonly string[]) {
  return (state: ExamState, action: ExamAction): ExamState => {
    const current = questionIds[state.index];
    if (action.type === 'goTo') {
      const id = questionIds[action.index];
      if (!id || action.index === state.index) return state;
      return { ...state, index: action.index, visited: { ...state.visited, [id]: true } };
    }
    if (!current || state.locked[current]) return state;
    if (action.type === 'choose') {
      if (state.answers[current] === action.optionId) return state;
      return { ...state, answers: { ...state.answers, [current]: action.optionId } };
    }
    if (action.type === 'clear')
      return current in state.answers ? { ...state, answers: without(state.answers, current) } : state;
    return {
      ...state,
      marked: state.marked[current] ? without(state.marked, current) : { ...state.marked, [current]: true },
    };
  };
}

export function questionState(state: ExamState, id: string): QuestionState {
  const answered = id in state.answers;
  if (state.locked[id]) return answered ? 'lockedAnswered' : 'lockedNotAnswered';
  if (state.marked[id]) return answered ? 'answeredMarked' : 'marked';
  if (answered) return 'answered';
  return state.visited[id] ? 'notAnswered' : 'notVisited';
}

/** What a key does on the exam screen (EX-09, A11Y-06). */
export type Shortcut =
  | { type: 'option'; index: number }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'mark' }
  | { type: 'time' }
  | { type: 'help' };

/**
 * The exam's keys, case-insensitive: `1` to `6` and `A` to `F` choose the option at that position, `N` next, `P`
 * previous, `M` mark for review, `T` the time left, `?` the shortcut list. With Ctrl, Alt or Meta a key is left alone,
 * so the shortcuts never take a browser or lockdown key (EX-09).
 */
export function shortcutFor(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): Shortcut | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.key === '?') return { type: 'help' };
  const key = e.key.toLowerCase();
  if (/^[1-6]$/.test(key)) return { type: 'option', index: Number(key) - 1 };
  if (/^[a-f]$/.test(key)) return { type: 'option', index: key.charCodeAt(0) - 97 };
  if (key === 'n') return { type: 'next' };
  if (key === 'p') return { type: 'previous' };
  if (key === 'm') return { type: 'mark' };
  if (key === 't') return { type: 'time' };
  return null;
}
