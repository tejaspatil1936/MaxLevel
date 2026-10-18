import type { Difficulty, QuestionImage, QuestionOption, QuestionStatus } from '@mitaoe/shared';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { writer, type Tx } from './tx';

/** A question as stored under organizations/{orgId}/tests/{testId}/questions (spec 10.1, PLAN `Question`). */
export interface QuestionRecord {
  id: string;
  testId: string;
  sectionId?: string;
  order: number;
  type: 'single';
  prompt: string;
  images: QuestionImage[];
  options: QuestionOption[];
  correctOptionIds: string[];
  explanation?: string;
  marks?: number;
  negativeMarks?: number;
  difficulty?: Difficulty;
  tags: string[];
  timeLimitSec?: number;
  source: { kind: 'manual' | 'json' | 'ai'; jobId?: string; page?: number };
  status: QuestionStatus;
  createdAt: number;
  updatedAt: number;
}

/** What a new question is written with; the ID, test and timestamps are added here. */
export type QuestionInput = Omit<QuestionRecord, 'id' | 'testId' | 'type' | 'createdAt' | 'updatedAt'>;

type Optional = 'sectionId' | 'explanation' | 'marks' | 'negativeMarks' | 'difficulty' | 'timeLimitSec';

/** Fields to change; `null` removes an optional field (explanation, marks, section, …). */
export type QuestionUpdate = Partial<Omit<QuestionInput, Optional | 'order'>> & {
  [K in Optional]?: QuestionRecord[K] | null;
} & { updatedAt: number };

const defined = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export function questionsData(db: Firestore) {
  const col = (orgId: string, testId: string) => db.collection(`organizations/${orgId}/tests/${testId}/questions`);
  const toQuestion = (d: FirebaseFirestore.DocumentSnapshot): QuestionRecord => {
    const { orgId: _orgId, ...rest } = d.data() ?? {};
    return {
      ...(rest as Omit<QuestionRecord, 'id'>),
      id: d.id,
      type: 'single',
      images: rest.images ?? [],
      tags: rest.tags ?? [],
      correctOptionIds: rest.correctOptionIds ?? [],
    };
  };

  return {
    /** A test's questions in `order` (creation time breaks ties). */
    async listQuestions(orgId: string, testId: string): Promise<QuestionRecord[]> {
      const snap = await col(orgId, testId).get();
      return snap.docs
        .map(toQuestion)
        .sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },

    async getQuestion(orgId: string, testId: string, questionId: string): Promise<QuestionRecord | null> {
      const d = await col(orgId, testId).doc(questionId).get();
      return d.exists ? toQuestion(d) : null;
    },

    createQuestion(orgId: string, tx: Tx, testId: string, input: QuestionInput, now: number): string {
      const ref = col(orgId, testId).doc();
      writer(tx).create(ref, { orgId, testId, type: 'single', ...defined(input), createdAt: now, updatedAt: now });
      return ref.id;
    },

    updateQuestion(orgId: string, tx: Tx, testId: string, questionId: string, patch: QuestionUpdate): void {
      const fields = Object.fromEntries(
        Object.entries(defined(patch)).map(([k, v]) => [k, v === null ? FieldValue.delete() : v]),
      );
      writer(tx).update(col(orgId, testId).doc(questionId), fields);
    },

    deleteQuestion(orgId: string, tx: Tx, testId: string, questionId: string): void {
      writer(tx).delete(col(orgId, testId).doc(questionId));
    },

    /** Moves these questions to no section, for example when their section is deleted (Q-03). */
    clearSection(orgId: string, tx: Tx, testId: string, ids: readonly string[], now: number): void {
      ids.forEach((id) =>
        writer(tx).update(col(orgId, testId).doc(id), { sectionId: FieldValue.delete(), updatedAt: now }),
      );
    },

    /** Stores `order` 1, 2, … following `ids` (Q-01). */
    setOrder(orgId: string, tx: Tx, testId: string, ids: readonly string[], now: number): void {
      ids.forEach((id, i) => writer(tx).update(col(orgId, testId).doc(id), { order: i + 1, updatedAt: now }));
    },
  };
}
