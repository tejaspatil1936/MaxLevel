import {
  FINISHED_ATTEMPT_STATUSES,
  type ReportError,
  type ReportMetrics,
  type ReportScope,
  type ReportStatus,
  type SummaryStatus,
} from '@mitaoe/shared';
import { FieldValue, type Firestore, type Transaction } from 'firebase-admin/firestore';

/**
 * `organizations/{orgId}/reports/{reportId}` (spec 10.1, docs/testids/phase-7.md "Report record"): the API stores it
 * queued with the requester and the title of the moment; the worker fills in the rest.
 */
export interface ReportRecord {
  id: string;
  orgId: string;
  scope: ReportScope;
  refId: string;
  title: string;
  status: ReportStatus;
  includeXlsx: boolean;
  /** The uid of the admin or super admin who asked for it, and their admin name (a super admin's email). */
  createdBy: string;
  createdByName: string;
  createdAt: number;
  metrics?: ReportMetrics;
  summary?: string | null;
  recommendations?: string[];
  summaryStatus?: SummaryStatus;
  summaryCalls?: number;
  error?: ReportError | null;
  retryAt?: number | null;
  provider?: string;
  model?: string;
  pdfPath?: string;
  xlsxPath?: string;
  finishedAt?: number;
}

export type NewReport = Pick<
  ReportRecord,
  'id' | 'scope' | 'refId' | 'title' | 'includeXlsx' | 'createdBy' | 'createdByName' | 'createdAt'
>;

/** Whether the report was stored, or refused because the month's allowance was used up (nothing stored). */
export type CreateReportResult = 'created' | 'limit';

const toReport = (d: FirebaseFirestore.DocumentSnapshot): ReportRecord => ({
  ...(d.data() as Omit<ReportRecord, 'id'>),
  id: d.id,
});

export function reportsData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/reports`);
  const usageRef = (orgId: string, month: string) => db.doc(`organizations/${orgId}/usage/${month}`);

  return {
    /** A new report ID in the organization. */
    newReportId(orgId: string): string {
      return col(orgId).doc().id;
    },

    /**
     * EXP-06, EXP-07, FF-04: in one transaction, takes one unit of the month's `aiReports` allowance (refusing, with
     * nothing written, when `aiReports` has reached `limit`), stores the queued report and lets `audit` write its
     * entry, so two requests at the limit never both pass and nothing is counted without its report.
     */
    async createReport(
      orgId: string,
      rec: NewReport,
      usage: { month: string; limit: number },
      audit: (tx: Transaction) => void,
    ): Promise<CreateReportResult> {
      return db.runTransaction(async (tx) => {
        const used = ((await tx.get(usageRef(orgId, usage.month))).get('aiReports') as number | undefined) ?? 0;
        if (used >= usage.limit) return 'limit';
        const { id, ...fields } = rec;
        tx.create(col(orgId).doc(id), { ...fields, orgId, status: 'queued' satisfies ReportStatus });
        tx.set(
          usageRef(orgId, usage.month),
          { orgId, month: usage.month, aiReports: FieldValue.increment(1) },
          { merge: true },
        );
        audit(tx);
        return 'created';
      });
    },

    /** A report of this organization, or null (another organization's report is not found, ORG-05). */
    async getReport(orgId: string, reportId: string): Promise<ReportRecord | null> {
      const d = await col(orgId).doc(reportId).get();
      return d.exists ? toReport(d) : null;
    },

    /** Every report of the organization, newest first (`createdAt`, then ID); past reports are never dropped. */
    async listReports(orgId: string): Promise<ReportRecord[]> {
      const snap = await col(orgId).orderBy('createdAt', 'desc').get();
      return snap.docs
        .map(toReport)
        .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
    },

    /** Whether any of these tests has a finished (submitted, auto-submitted or terminated) attempt. */
    async hasFinishedAttempt(orgId: string, testIds: ReadonlyArray<string>): Promise<boolean> {
      const attempts = db.collection(`organizations/${orgId}/attempts`);
      const found = await Promise.all(
        testIds.map(async (testId) =>
          attempts
            .where('testId', '==', testId)
            .where('status', 'in', [...FINISHED_ATTEMPT_STATUSES])
            .limit(1)
            .get()
            .then((s) => !s.empty),
        ),
      );
      return found.some(Boolean);
    },
  };
}
