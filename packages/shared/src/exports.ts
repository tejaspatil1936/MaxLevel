import { z } from 'zod';
import type { AttemptStatus } from './attempt';
import type { TaskRequest } from './tasks';

// Results exports (spec 8.6 EXP-01 to EXP-03; docs/testids/phase-4.md "Export results region" and "Files"). The API
// stores the request and queues `/tasks/export`; the worker builds the tables (export-tables.ts) and writes the file.

const id = z.string().min(1).max(128);

export const EXPORT_SCOPES = ['test', 'series'] as const;
export const EXPORT_FORMATS = ['csv', 'xlsx'] as const;
export const EXPORT_STATUSES = ['queued', 'running', 'ready', 'failed'] as const;
export type ExportScope = (typeof EXPORT_SCOPES)[number];
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export type ExportStatus = (typeof EXPORT_STATUSES)[number];

/** `POST /v1/exports` (with an Idempotency-Key, API-02). */
export const exportRequestSchema = z.object({
  scope: z.enum(EXPORT_SCOPES),
  refId: id,
  format: z.enum(EXPORT_FORMATS),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

/** The answer to `POST /v1/exports`. */
export const exportCreatedSchema = z.object({ id: z.string(), status: z.enum(EXPORT_STATUSES) });
export type ExportCreated = z.infer<typeof exportCreatedSchema>;

/** `GET /v1/exports/{id}`: once `ready`, a fresh signed link valid for `EXPORT_LINK_TTL_MS` (EXP-03). */
export const exportInfoSchema = exportRequestSchema.extend({
  id: z.string(),
  status: z.enum(EXPORT_STATUSES),
  url: z.string().optional(),
  expiresAt: z.number().int().optional(),
  filename: z.string().optional(),
});
export type ExportInfo = z.infer<typeof exportInfoSchema>;

/** EXP-03: download links work for 15 minutes on the server clock. */
export const EXPORT_LINK_TTL_MS = 15 * 60_000;

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** `results-<testId>.csv` or `series-results-<seriesId>.xlsx`. */
export const exportFilename = (scope: ExportScope, refId: string, format: ExportFormat) =>
  `${scope === 'series' ? 'series-results' : 'results'}-${refId}.${format}`;

export interface ExportPayload {
  orgId: string;
  exportId: string;
}

/** EXP-03: the worker task that builds one export, due at once; one task per export. */
export function exportTask(orgId: string, exportId: string): TaskRequest<ExportPayload> {
  return { name: `export-${orgId}-${exportId}`, path: '/tasks/export', payload: { orgId, exportId } };
}

/** Status words of the files: phase 3's, plus `In progress`. */
export const EXPORT_STATUS_WORDS: Record<Exclude<AttemptStatus, 'reset'>, string> = {
  submitted: 'Submitted',
  auto_submitted: 'Submitted automatically',
  terminated: 'Ended after strikes',
  in_progress: 'In progress',
};

export const TERMINATION_WORDS: Record<string, string> = { max_strikes: 'Maximum strikes reached' };

/** EXP-01: the test export's header row; one `<section> score` column per section, times named by `zone`. */
export function testExportColumns(sections: ReadonlyArray<{ name: string }>, zone: string): string[] {
  return [
    'Name',
    'Email',
    'PRN',
    'Department',
    'Graduation year',
    'Status',
    'Score',
    'Maximum',
    'Percentage',
    'Rank',
    ...sections.map((s) => `${s.name} score`),
    'Correct',
    'Incorrect',
    'Unanswered',
    `Started at (${zone})`,
    `Submitted at (${zone})`,
    'Time taken (seconds)',
    'Strikes',
    'Termination reason',
    'Extra time (minutes)',
  ];
}

/** EXP-02: the series export's header row, one column per test heading in scheduled order. */
export function seriesExportColumns(testHeadings: ReadonlyArray<string>): string[] {
  return ['Name', 'Email', 'PRN', 'Department', 'Graduation year', ...testHeadings, 'Total', 'Rank'];
}

/** EXP-02: an Excel sheet name from a test heading: `: \ / ? * [ ]` removed, spaces collapsed, at most 31 characters. */
export function xlsxSheetName(heading: string): string {
  return heading
    .replace(/[:\\/?*[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
    .trim();
}

/**
 * Sheet names for these headings, each unique (Excel compares them ignoring case) and never one of `taken`: a repeat
 * gets ` (2)`, ` (3)` … within the 31 characters, and an empty name is `Test`.
 */
export function xlsxSheetNames(headings: ReadonlyArray<string>, taken: ReadonlyArray<string> = []): string[] {
  const used = new Set(taken.map((n) => n.toLowerCase()));
  return headings.map((h) => {
    const base = xlsxSheetName(h) || 'Test';
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - ` (${n})`.length)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

/** The zone's short name at an instant, for example `IST` for Asia/Kolkata. */
export function zoneShortName(timeZone: string, at: number): string {
  const parts = new Intl.DateTimeFormat('en-IN', { timeZone, timeZoneName: 'short' }).formatToParts(at);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
}

/** A time in an export: `yyyy-MM-dd HH:mm:ss` in the organization's timezone. */
export function exportDateTime(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ms);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
