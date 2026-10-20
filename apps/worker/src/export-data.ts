import type {
  DayLabelTest,
  ExportAttempt,
  ExportFormat,
  ExportScope,
  ExportStatus,
  ExportStudent,
} from '@mitaoe/shared';
import type { DocumentSnapshot, Firestore } from 'firebase-admin/firestore';
import type { StoredBoardRow } from './data';

// What the export task reads and writes (EXP-01 to EXP-03; ORG-03: every function takes orgId first): the export
// record the API stored, the test or series with its attempts, the students' profiles and the stored boards.

export interface ExportRecord {
  id: string;
  orgId: string;
  scope: ExportScope;
  refId: string;
  format: ExportFormat;
  status: ExportStatus;
  filePath: string;
}

/** A test as the export names and orders it; `published` once it has a settings snapshot. */
export interface ExportTest extends DayLabelTest {
  seriesId: string;
  title: string;
  sections: Array<{ id: string; name: string }>;
  published: boolean;
  createdAt: number;
}

const toTest = (d: DocumentSnapshot): ExportTest => ({
  id: d.id,
  seriesId: d.get('seriesId') as string,
  title: (d.get('title') as string | undefined) ?? '',
  scheduledDate: (d.get('scheduledDate') as string | undefined) ?? '',
  dayNumber: (d.get('dayNumber') as string | null | undefined) ?? null,
  dayHidden: d.get('dayHidden') === true,
  sections: ((d.get('sections') as Array<{ id: string; name: string }> | undefined) ?? []).map((s) => ({
    id: s.id,
    name: s.name,
  })),
  published: !!d.get('resolved'),
  createdAt: (d.get('createdAt') as number | undefined) ?? 0,
});

const toAttempt = (d: DocumentSnapshot): ExportAttempt & { testId: string } => ({
  testId: d.get('testId') as string,
  studentId: d.get('studentId') as string,
  status: d.get('status') as ExportAttempt['status'],
  startedAt: (d.get('startedAt') as number | undefined) ?? 0,
  ...(typeof d.get('submittedAt') === 'number' ? { submittedAt: d.get('submittedAt') as number } : {}),
  strikesCount: (d.get('strikesCount') as number | undefined) ?? 0,
  ...(typeof d.get('terminationReason') === 'string'
    ? { terminationReason: d.get('terminationReason') as string }
    : {}),
  extraTimeSec: (d.get('extraTimeSec') as number | undefined) ?? 0,
  ...(d.get('result') ? { result: d.get('result') as ExportAttempt['result'] } : {}),
});

const RESTARTABLE: ReadonlySet<string> = new Set(['queued', 'running']);

export function exportData(db: Firestore) {
  const org = (orgId: string) => db.doc(`organizations/${orgId}`);
  const exportRef = (orgId: string, exportId: string) => org(orgId).collection('exports').doc(exportId);

  return {
    /**
     * EXP-03, REL-04: marks a queued export (or one whose earlier run stopped midway) `running` and returns it; null
     * for a missing, ready or failed export, so a second run changes nothing.
     */
    async startExport(orgId: string, exportId: string, now: number): Promise<ExportRecord | null> {
      const ref = exportRef(orgId, exportId);
      return db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists || !RESTARTABLE.has(snap.get('status') as string)) return null;
        tx.update(ref, { status: 'running', startedAt: now });
        return { ...(snap.data() as Omit<ExportRecord, 'id'>), id: snap.id, status: 'running' };
      });
    },

    /** Stores how the run ended: `ready` once the file is saved, or `failed`. */
    async endExport(orgId: string, exportId: string, status: 'ready' | 'failed', now: number): Promise<void> {
      await exportRef(orgId, exportId).update(
        status === 'ready' ? { status, readyAt: now } : { status, failedAt: now },
      );
    },

    /** The organization's timezone (Asia/Kolkata unless set). */
    async timezone(orgId: string): Promise<string> {
      return ((await org(orgId).get()).get('timezone') as string | undefined) ?? 'Asia/Kolkata';
    },

    async getTest(orgId: string, testId: string): Promise<ExportTest | null> {
      const d = await org(orgId).collection('tests').doc(testId).get();
      return d.exists ? toTest(d) : null;
    },

    async seriesExists(orgId: string, seriesId: string): Promise<boolean> {
      return (await org(orgId).collection('series').doc(seriesId).get()).exists;
    },

    /** Every test of a series in schedule order: scheduled date, then creation order (as the API lists them). */
    async listSeriesTests(orgId: string, seriesId: string): Promise<ExportTest[]> {
      const snap = await org(orgId).collection('tests').where('seriesId', '==', seriesId).get();
      return snap.docs
        .map(toTest)
        .sort(
          (a, b) =>
            a.scheduledDate.localeCompare(b.scheduledDate) || a.createdAt - b.createdAt || a.id.localeCompare(b.id),
        );
    },

    /** Every attempt of a test, whatever its status. */
    async listAttempts(orgId: string, testId: string): Promise<Array<ExportAttempt & { testId: string }>> {
      const snap = await org(orgId).collection('attempts').where('testId', '==', testId).get();
      return snap.docs.map(toAttempt);
    },

    /** Profiles of the named students with their department's name; unknown students are left out. */
    async students(orgId: string, studentIds: Iterable<string>): Promise<Map<string, ExportStudent>> {
      const ids = [...new Set(studentIds)];
      const [docs, departments] = await Promise.all([
        ids.length ? db.getAll(...ids.map((id) => org(orgId).collection('students').doc(id))) : [],
        org(orgId).collection('departments').select('name').get(),
      ]);
      const names = new Map(departments.docs.map((d) => [d.id, d.get('name') as string]));
      return new Map(
        docs
          .filter((d) => d.exists)
          .map((d) => [
            d.id,
            {
              name: (d.get('name') as string | null | undefined) ?? '',
              email: (d.get('email') as string | undefined) ?? '',
              prn: (d.get('prn') as string | null | undefined) ?? '',
              department: names.get(d.get('departmentId') as string) ?? '',
              graduationYear: (d.get('graduationYear') as number | null | undefined) ?? null,
            },
          ]),
      );
    },

    /** Every row of a stored board in rank order (all its pages), or none while it has not been computed. */
    async boardRows(orgId: string, boardId: string): Promise<StoredBoardRow[]> {
      const ref = org(orgId).collection('leaderboards').doc(boardId);
      const head = await ref.get();
      if (!head.exists) return [];
      const pageCount = (head.get('pageCount') as number | undefined) ?? 1;
      const more =
        pageCount > 1
          ? await db.getAll(
              ...Array.from({ length: pageCount - 1 }, (_, i) => ref.collection('pages').doc(String(i + 1))),
            )
          : [];
      return [head, ...more].flatMap((d) => (d.get('rows') as StoredBoardRow[] | undefined) ?? []);
    },
  };
}
export type ExportData = ReturnType<typeof exportData>;
