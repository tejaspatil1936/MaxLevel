import type { EligibilityRules, Section, Settings, SettingsOverrides, TestStatus } from '@mitaoe/shared';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { writer, type Tx } from './tx';

/** A test as stored under organizations/{orgId}/tests (spec 5.2, PLAN `Test`). */
export interface TestRecord {
  id: string;
  seriesId: string;
  title: string;
  company?: string;
  dayNumber?: string | null;
  dayHidden: boolean;
  scheduledDate: string;
  overrides: SettingsOverrides;
  eligibility: EligibilityRules;
  sections: Section[];
  drawCount?: number;
  status: TestStatus;
  approval?: { status: 'approved'; approvedBy: string; approvedAt: number };
  resolved?: Settings;
  questionSetVersion: number;
  totalMarks: number;
  attemptsStarted: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TestInput {
  seriesId: string;
  title: string;
  company?: string;
  dayNumber?: string | null;
  dayHidden: boolean;
  scheduledDate: string;
}

/** Fields to change; `null` removes an optional field (company, day number, draw count). */
export type TestUpdate = Partial<{
  [K in keyof Omit<TestRecord, 'id' | 'seriesId' | 'createdAt'>]: TestRecord[K] | null;
}> & { updatedAt: number };

const NO_RULES: EligibilityRules = { departmentIds: [], graduationYears: [], include: [], exclude: [] };
/** Fields whose `null` means "remove"; dayNumber keeps an explicit null (no custom label). */
const REMOVABLE = new Set(['company', 'drawCount', 'approval', 'resolved']);

export function testsData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/tests`);
  const toTest = (d: FirebaseFirestore.DocumentSnapshot): TestRecord => {
    const opt = <K extends keyof TestRecord>(k: K) =>
      d.get(k) !== undefined && d.get(k) !== null ? { [k]: d.get(k) as TestRecord[K] } : {};
    return {
      id: d.id,
      seriesId: d.get('seriesId'),
      title: d.get('title'),
      ...opt('company'),
      dayNumber: d.get('dayNumber') ?? null,
      dayHidden: d.get('dayHidden') === true,
      scheduledDate: d.get('scheduledDate'),
      overrides: d.get('overrides') ?? {},
      eligibility: { ...NO_RULES, ...d.get('eligibility') },
      sections: d.get('sections') ?? [],
      ...opt('drawCount'),
      status: d.get('status') ?? 'draft',
      ...opt('approval'),
      ...opt('resolved'),
      questionSetVersion: d.get('questionSetVersion') ?? 1,
      totalMarks: d.get('totalMarks') ?? 0,
      attemptsStarted: d.get('attemptsStarted') === true,
      createdAt: d.get('createdAt') ?? 0,
      updatedAt: d.get('updatedAt') ?? 0,
    };
  };

  return {
    /** A series' tests in schedule order: scheduled date, then creation order (SER-03, TST-02). */
    async listTests(orgId: string, seriesId: string): Promise<TestRecord[]> {
      const snap = await col(orgId).where('seriesId', '==', seriesId).get();
      return snap.docs
        .map(toTest)
        .sort(
          (a, b) =>
            a.scheduledDate.localeCompare(b.scheduledDate) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
        );
    },

    async getTest(orgId: string, testId: string): Promise<TestRecord | null> {
      const d = await col(orgId).doc(testId).get();
      return d.exists ? toTest(d) : null;
    },

    /** A new test is a draft with no overrides, no sections and no questions (TST-01, TST-04). */
    createTest(orgId: string, tx: Tx, input: TestInput, now: number): string {
      const ref = col(orgId).doc();
      writer(tx).create(ref, {
        orgId,
        seriesId: input.seriesId,
        title: input.title,
        ...(input.company ? { company: input.company } : {}),
        ...(input.dayNumber ? { dayNumber: input.dayNumber } : {}),
        dayHidden: input.dayHidden,
        scheduledDate: input.scheduledDate,
        overrides: {},
        eligibility: NO_RULES,
        sections: [],
        status: 'draft',
        questionSetVersion: 1,
        totalMarks: 0,
        attemptsStarted: false,
        createdAt: now,
        updatedAt: now,
      });
      return ref.id;
    },

    /** A new ID for a section added through PATCH. */
    newSectionId(orgId: string): string {
      return col(orgId).doc().id;
    },

    updateTest(orgId: string, tx: Tx, testId: string, patch: TestUpdate): void {
      const fields = Object.fromEntries(
        Object.entries(patch)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, v === null && REMOVABLE.has(k) ? FieldValue.delete() : v]),
      );
      writer(tx).update(col(orgId).doc(testId), fields);
    },
  };
}
