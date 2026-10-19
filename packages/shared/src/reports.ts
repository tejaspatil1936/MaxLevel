import { z } from 'zod';
import { reportMetricsSchema } from './report-metrics';
import type { TaskRequest } from './tasks';

// Analytics reports (spec EXP-05 to EXP-07; docs/testids/phase-7.md "Requests the tests send directly" and "Report
// files"). The API stores the request and queues `/tasks/report`; the worker computes the metrics, asks the model for
// the summary, prints the PDF (and the optional XLSX) and marks the report `ready`.

const id = z.string().min(1).max(128);

export const REPORT_SCOPES = ['test', 'series'] as const;
export const REPORT_STATUSES = ['queued', 'running', 'retrying', 'ready', 'failed'] as const;
export const SUMMARY_STATUSES = ['accepted', 'rejected'] as const;
export type ReportScope = (typeof REPORT_SCOPES)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];
export type SummaryStatus = (typeof SUMMARY_STATUSES)[number];

/** `POST /v1/reports` (with an Idempotency-Key, API-02). */
export const reportRequestSchema = z.object({
  scope: z.enum(REPORT_SCOPES),
  refId: id,
  includeXlsx: z.boolean().optional(),
});
export type ReportRequest = z.infer<typeof reportRequestSchema>;

/** The answer to an accepted `POST /v1/reports`. */
export const reportCreatedSchema = z.object({ id: z.string(), status: z.literal('queued') });

export const reportErrorSchema = z.object({ code: z.string(), message: z.string(), retryable: z.boolean() });
export type ReportError = z.infer<typeof reportErrorSchema>;

/** A signed download link, fresh on every request and valid for 15 minutes on the server clock (EXP-06, EXP-03). */
export const signedFileSchema = z.object({ url: z.string(), expiresAt: z.number().int(), filename: z.string() });
export type SignedFile = z.infer<typeof signedFileSchema>;

/** A report as `GET /v1/reports` lists it: the view without metrics, summary and recommendations. */
export const reportListItemSchema = z.object({
  id: z.string(),
  scope: z.enum(REPORT_SCOPES),
  refId: z.string(),
  title: z.string(),
  status: z.enum(REPORT_STATUSES),
  includeXlsx: z.boolean(),
  createdAt: z.number().int(),
  createdBy: z.object({ uid: z.string(), name: z.string() }),
  error: reportErrorSchema.optional(),
  retryAt: z.number().int().optional(),
  summaryStatus: z.enum(SUMMARY_STATUSES).optional(),
  provider: z.string().optional(),
  model: z.string().optional(),
  pdf: signedFileSchema.optional(),
  xlsx: signedFileSchema.optional(),
});
export type ReportListItem = z.infer<typeof reportListItemSchema>;

/** `GET /v1/reports/{id}`: once `ready`, the metrics, the summary (or null) and the recommendations too. */
export const reportViewSchema = reportListItemSchema.extend({
  metrics: reportMetricsSchema.optional(),
  summary: z.string().nullable().optional(),
  recommendations: z.array(z.string()).optional(),
});
export type ReportView = z.infer<typeof reportViewSchema>;

export const REPORT_CONTENT_TYPES = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;
export type ReportFileKind = keyof typeof REPORT_CONTENT_TYPES;

/** Where the worker stores a report's files (exactly these paths, docs/testids/phase-7.md). */
export const reportFilePath = (orgId: string, reportId: string, kind: ReportFileKind) =>
  `organizations/${orgId}/reports/${reportId}/${kind === 'pdf' ? 'report.pdf' : 'metrics.xlsx'}`;

/** The download names: `report-<reportId>.pdf` and `report-<reportId>-metrics.xlsx`. */
export const reportFilename = (reportId: string, kind: ReportFileKind) =>
  kind === 'pdf' ? `report-${reportId}.pdf` : `report-${reportId}-metrics.xlsx`;

/** The report's error while the model does not answer (REL-06), and once it has failed 4 times in a row. */
export const REPORT_MESSAGES = {
  llmUnavailable: "The AI service didn't answer.",
  llmGaveUp: "The AI service didn't answer after 4 tries.",
  internal: 'Something went wrong while making this report.',
  limitReached: (max: number) => `This month's analytics report limit (${max}) is used up.`,
  noFinishedAttempts: (scope: ReportScope) =>
    `This ${scope} has no finished attempts yet, so there is nothing to report.`,
} as const;

export interface ReportPayload {
  orgId: string;
  reportId: string;
}

/**
 * The worker task that makes one report, due at `scheduleTime` (now when omitted). The first is `report-<reportId>`;
 * a later run (a model retry, a lease check) adds `run`, so a done task never hides it, and keeps the report ID.
 */
export function reportTask(
  orgId: string,
  reportId: string,
  run?: string,
  scheduleTime?: number,
): TaskRequest<ReportPayload> {
  return {
    name: run ? `report-${reportId}-${run}` : `report-${reportId}`,
    path: '/tasks/report',
    payload: { orgId, reportId },
    ...(scheduleTime === undefined ? {} : { scheduleTime }),
  };
}
