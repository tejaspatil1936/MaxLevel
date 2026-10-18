// The exam screen's working state (EX-07, EX-08): where the student is, their answers and marks for review. The preview
// keeps it in memory only (Q-13); the attempt mode adds saving on top of the same reducer.

export interface ExamState {
  /** Index of the question shown, in exam order. */
  index: number;
  answers: Readonly<Record<string, string>>;
  marked: Readonly<Record<string, true>>;
  visited: Readonly<Record<string, true>>;
}

export type ExamAction =
  { type: 'choose'; optionId: string } | { type: 'clear' } | { type: 'toggleMark' } | { type: 'goTo'; index: number };

/** The palette states of EX-07 (locked arrives with per-question timers). */
export type QuestionState = 'notVisited' | 'notAnswered' | 'answered' | 'marked' | 'answeredMarked';

export function initialExamState(questionIds: readonly string[]): ExamState {
  const first = questionIds[0];
  return { index: 0, answers: {}, marked: {}, visited: first ? { [first]: true } : {} };
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
    if (!current) return state;
    if (action.type === 'choose') return { ...state, answers: { ...state.answers, [current]: action.optionId } };
    if (action.type === 'clear') return { ...state, answers: without(state.answers, current) };
    return {
      ...state,
      marked: state.marked[current] ? without(state.marked, current) : { ...state.marked, [current]: true },
    };
  };
}

export function questionState(state: ExamState, id: string): QuestionState {
  const answered = id in state.answers;
  if (state.marked[id]) return answered ? 'answeredMarked' : 'marked';
  if (answered) return 'answered';
  return state.visited[id] ? 'notAnswered' : 'notVisited';
}
