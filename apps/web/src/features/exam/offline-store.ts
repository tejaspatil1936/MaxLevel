import type { AttemptPayload } from '@mitaoe/shared';
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { LocalAnswerState, PendingAnswer } from './answer-sync';

// The exam's device store (EX-10, US-ST-05): the exam payload, the server clock offset and every local answer are kept
// in IndexedDB, so reloading the exam while the API can't be reached still shows it with every answer and the waiting
// count. Nothing here holds the answer key: the payload is the student-facing one (DATA-05). Every call swallows
// storage failures (private windows, blocked storage): the exam then runs from memory as before.

export interface DeviceExam {
  attemptId: string;
  /** The signed-in user the exam belongs to; another account on the same browser never gets it. */
  uid: string;
  orgId: string;
  payload: AttemptPayload;
  clockOffsetMs: number;
}

export interface DeviceAnswer extends PendingAnswer {
  attemptId: string;
  state: LocalAnswerState;
}

interface ExamDb extends DBSchema {
  exams: { key: string; value: DeviceExam };
  answers: { key: [string, string]; value: DeviceAnswer; indexes: { attempt: string } };
}

let db: Promise<IDBPDatabase<ExamDb>> | null = null;
const open = () =>
  (db ??= openDB<ExamDb>('mitaoe-exam', 1, {
    upgrade(d) {
      d.createObjectStore('exams', { keyPath: 'attemptId' });
      d.createObjectStore('answers', { keyPath: ['attemptId', 'questionId'] }).createIndex('attempt', 'attemptId');
    },
  }));

async function quietly<T>(fn: (d: IDBPDatabase<ExamDb>) => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn(await open());
  } catch {
    return fallback;
  }
}

export const putDeviceExam = (exam: DeviceExam) =>
  quietly((d) => d.put('exams', exam).then(() => undefined), undefined);

/** The kept exam of this attempt, only for the user it belongs to. */
export const getDeviceExam = (attemptId: string, uid: string) =>
  quietly(async (d) => {
    const exam = await d.get('exams', attemptId);
    return exam?.uid === uid ? exam : undefined;
  }, undefined);

export const getDeviceAnswers = (attemptId: string) =>
  quietly((d) => d.getAllFromIndex('answers', 'attempt', attemptId), [] as DeviceAnswer[]);

/** Keeps an answer's newest state: a write never replaces a newer change of the same question. */
export const putDeviceAnswer = (attemptId: string, answer: PendingAnswer, state: LocalAnswerState) =>
  quietly(async (d) => {
    const tx = d.transaction('answers', 'readwrite');
    const current = await tx.store.get([attemptId, answer.questionId]);
    if (!current || current.seq <= answer.seq) await tx.store.put({ ...answer, attemptId, state });
    await tx.done;
  }, undefined);

/** Forgets a finished attempt's exam and answers. */
export const clearDeviceExam = (attemptId: string) =>
  quietly(async (d) => {
    const tx = d.transaction(['exams', 'answers'], 'readwrite');
    await tx.objectStore('exams').delete(attemptId);
    const answers = tx.objectStore('answers');
    for (const key of await answers.index('attempt').getAllKeys(attemptId)) await answers.delete(key);
    await tx.done;
  }, undefined);

/**
 * The exam as the device knows it: device answers newer than the payload's (by seq) replace them, and those not yet
 * accepted by the server wait to be sent. A refused answer shows as it was saved on the server.
 */
export function mergeDeviceAnswers(
  answers: AttemptPayload['answers'],
  device: readonly DeviceAnswer[],
): { answers: AttemptPayload['answers']; waiting: PendingAnswer[] } {
  const merged = { ...answers };
  const waiting: PendingAnswer[] = [];
  for (const { attemptId: _a, state, ...a } of device) {
    if (state === 'rejected' || a.seq <= (answers[a.questionId]?.seq ?? 0)) continue;
    merged[a.questionId] = {
      optionId: a.optionId,
      seq: a.seq,
      ...(a.markedForReview ? { markedForReview: true } : {}),
    };
    if (state === 'waiting') waiting.push(a);
  }
  return { answers: merged, waiting };
}
