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
  | { type: 'choose'; optionId: string }
  | { type: 'clear' }
  | { type: 'toggleMark' }
  | { type: 'goTo'; index: number }
  /** Per-question timers (Q-11): the current question's time ran out or Save and next left it; it locks, next opens. */
  | { type: 'lock' };

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

/**
 * Where a timed attempt reopens (Q-11, forward-only): on the latest question served, with every question before it
 * locked; when that question's time is up (`timeUpAt` at or before `now`) it is locked too and the next one opens.
 */
export function resumeTimedState(
  state: ExamState,
  questionIds: readonly string[],
  servedAt: Readonly<Record<string, number>>,
  timeUpAt: (questionId: string, servedAt: number) => number | undefined,
  now: number,
): ExamState {
  const latest = questionIds.findLastIndex((id) => servedAt[id] !== undefined);
  if (latest < 0) return state;
  const locked: Record<string, true> = { ...state.locked };
  const visited: Record<string, true> = { ...state.visited };
  for (const id of questionIds.slice(0, latest + 1)) visited[id] = true;
  for (const id of questionIds.slice(0, latest)) locked[id] = true;
  const id = questionIds[latest]!;
  const upAt = timeUpAt(id, servedAt[id]!);
  let index = latest;
  if (upAt !== undefined && upAt <= now) {
    locked[id] = true;
    if (latest + 1 < questionIds.length) index = latest + 1;
  }
  visited[questionIds[index]!] = true;
  return { ...state, index, locked, visited };
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
      if (!id || action.index === state.index || state.locked[id]) return state;
      return { ...state, index: action.index, visited: { ...state.visited, [id]: true } };
    }
    if (action.type === 'lock') {
      if (!current) return state;
      const locked = state.locked[current] ? state.locked : { ...state.locked, [current]: true as const };
      const next = questionIds[state.index + 1];
      if (!next) return locked === state.locked ? state : { ...state, locked };
      return { ...state, locked, index: state.index + 1, visited: { ...state.visited, [next]: true } };
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
