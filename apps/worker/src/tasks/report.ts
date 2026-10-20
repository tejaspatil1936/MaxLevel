import { randomUUID } from 'node:crypto';
import {
  computeSeriesMetrics,
  computeTestMetrics,
  importRetryDelayMs,
  REPORT_CONTENT_TYPES,
  REPORT_MESSAGES,
  reportFilePath,
  ReportSummarySchema,
  reportTask,
  SUMMARY_MAX_CALLS,
  summaryMessages,
  unsupportedInAnswer,
  type Clock,
  type ReportError,
  type ReportMetrics,
  type ReportSummary,
  type TaskQueue,
} from '@mitaoe/shared';
import { z } from 'zod';
import type { FileStore } from '../firebase';
import { LlmUnavailableError, type LlmDriver } from '../llm/driver';
import { ReportLeaseLost, type ReportData, type ReportRecord, type ReportUpdate } from '../report-data';
import type { PdfPrinter } from '../report-pdf';
import { renderReportHtml } from '../report-render';
import { reportXlsx } from '../report-xlsx';

export const reportPayloadSchema = z.object({
  orgId: z.string().min(1).max(128),
  reportId: z.string().min(1).max(128),
});
export type ReportRun = z.infer<typeof reportPayloadSchema>;

/** A run holds the report this long (on the Clock) before another delivery may take it over. */
const REPORT_LEASE_MS = 5 * 60_000;
/** An error no step expects fails the report on this delivery of its task (earlier ones are retried by the queue). */
const REPORT_MAX_DELIVERIES = 5;

const failure = (code: string, message: string, retryable: boolean): ReportError => ({ code, message, retryable });

interface ReportDeps {
  reports: ReportData;
  files: FileStore;
  printer: PdfPrinter;
  clock: Clock;
  queue: TaskQueue;
  llm?: LlmDriver;
  /** The page's font as a data: URL, read once. */
  fontUrl?: () => Promise<string | undefined>;
  log?: { error?: (obj: object, msg: string) => void };
}

/**
 * /tasks/report (EXP-04 to EXP-06, REL-04, REL-06): computes the metrics from the stored attempts (once; a retry reuses
 * them), asks the model for the summary with only the metrics JSON, re-asking (at most 3 answers) while an answer
 * quotes a number the metrics do not hold, prints the PDF with headless Chromium, stores it (and the optional XLSX)
 * and marks the report `ready`. A model failure waits `retrying` 1, 2 then 4 minutes with the next run queued at
 * `retryAt`; the fourth in a row fails the report. Every write checks the run's lease, so a task delivered twice
 * changes nothing; every handled case answers the queue 200.
 */
export function reportHandler(deps: ReportDeps) {
  const { reports: data, clock, queue, llm } = deps;
  const lease = () => clock.now() + REPORT_LEASE_MS;

  async function metricsOf(orgId: string, report: ReportRecord): Promise<ReportMetrics | null> {
    if (report.metrics) return report.metrics;
    if (report.scope === 'test') {
      const inputs = await data.testInputs(orgId, report.refId);
      return inputs && computeTestMetrics({ title: report.title, ...inputs });
    }
    const inputs = await data.seriesInputs(orgId, report.refId);
    return inputs && computeSeriesMetrics({ title: report.title, ...inputs });
  }

  /** One summary call: the answer when it fits ReportSummarySchema, or null for a model failure. */
  async function ask(messages: { system: string; prompt: string }) {
    if (!llm) return { answer: null, usage: { inputTokens: 0, outputTokens: 0 } };
    try {
      const res = await llm.summarize(messages);
      const parsed = ReportSummarySchema.safeParse(res.output);
      return { answer: parsed.success ? parsed.data : null, usage: res.usage };
    } catch (err) {
      if (err instanceof LlmUnavailableError) return { answer: null, usage: { inputTokens: 0, outputTokens: 0 } };
      throw err;
    }
  }

  async function run(orgId: string, report: ReportRecord, runId: string): Promise<string> {
    const save = (u: ReportUpdate) => data.update(orgId, report.id, runId, u);
    const metrics = await metricsOf(orgId, report);
    if (!metrics) {
      await save({
        status: 'failed',
        error: failure('NOT_FOUND', 'The test or series of this report is no longer published.', false),
        leaseUntil: null,
      });
      return 'failed: NOT_FOUND';
    }
    if (!report.metrics) await save({ metrics, leaseUntil: lease() });

    // An answer accepted by an earlier run (whose print failed) is used as it is.
    let summary: ReportSummary | null =
      report.summaryStatus === 'accepted' && report.summary
        ? { summary: report.summary, recommendations: report.recommendations ?? [] }
        : null;
    let calls = report.summaryCalls ?? 0;
    let rejections = report.rejections ?? 0;
    const rejected = [...(report.rejectedNumbers ?? [])];
    const tokens = { input: report.tokens?.input ?? 0, output: report.tokens?.output ?? 0 };
    while (!summary && rejections < SUMMARY_MAX_CALLS) {
      const { answer, usage } = await ask(summaryMessages(metrics, rejected));
      calls++;
      tokens.input += usage.inputTokens;
      tokens.output += usage.outputTokens;
      if (!answer) {
        // A model failure (REL-06): wait and try again on the schedule, or fail on the fourth in a row.
        const failures = (report.failures ?? 0) + 1;
        const delay = importRetryDelayMs(failures);
        const counts = { summaryCalls: calls, failures, tokens, leaseUntil: null };
        if (delay === null) {
          const error = failure('LLM_UNAVAILABLE', REPORT_MESSAGES.llmGaveUp, false);
          await save({ ...counts, status: 'failed', error, retryAt: null, finishedAt: clock.now() });
          return 'failed: LLM_UNAVAILABLE';
        }
        const retryAt = clock.now() + delay;
        await queue.enqueue(reportTask(orgId, report.id, `retry-${failures}-${retryAt}`, retryAt));
        const error = failure('LLM_UNAVAILABLE', REPORT_MESSAGES.llmUnavailable, true);
        await save({ ...counts, status: 'retrying', error, retryAt });
        return `retrying at ${retryAt}`;
      }
      report.failures = 0;
      const unsupported = unsupportedInAnswer(answer, metrics);
      if (unsupported.length === 0) {
        summary = answer;
        break;
      }
      // A rejected answer is not used and is no failure: ask again at once, naming the numbers.
      rejections++;
      rejected.push(...unsupported);
      await save({
        summaryCalls: calls,
        rejections,
        rejectedNumbers: rejected,
        failures: 0,
        tokens,
        leaseUntil: lease(),
      });
    }

    // The summary is decided: store it with a fresh lease before the print, so a delivery after a failed or slow
    // print neither asks the model again nor takes the report over while it prints.
    const decided = {
      summary: summary?.summary ?? null,
      recommendations: summary?.recommendations ?? [],
      summaryStatus: summary ? ('accepted' as const) : ('rejected' as const),
    };
    await save({ ...decided, summaryCalls: calls, rejections, failures: 0, tokens, leaseUntil: lease() });

    const { name, timezone } = await data.orgInfo(orgId);
    const html = renderReportHtml({
      metrics,
      orgName: name,
      timeZone: timezone,
      requestedAt: report.createdAt,
      summary,
      fontUrl: await deps.fontUrl?.(),
    });
    const pdfPath = reportFilePath(orgId, report.id, 'pdf');
    await deps.files.save(pdfPath, await deps.printer.print(html), REPORT_CONTENT_TYPES.pdf);
    const xlsxPath = report.includeXlsx ? reportFilePath(orgId, report.id, 'xlsx') : undefined;
    if (xlsxPath) await deps.files.save(xlsxPath, await reportXlsx(metrics), REPORT_CONTENT_TYPES.xlsx);
    await save({
      status: 'ready',
      ...decided,
      summaryCalls: calls,
      rejections,
      failures: 0,
      tokens,
      error: null,
      retryAt: null,
      ...(llm ? { provider: llm.provider, model: llm.model } : {}),
      pdfPath,
      ...(xlsxPath ? { xlsxPath } : {}),
      finishedAt: clock.now(),
      leaseUntil: null,
    });
    return `ready: summary ${summary ? 'accepted' : 'rejected'}`;
  }

  /** `retryCount` is the queue's count of earlier deliveries of this task (X-CloudTasks-TaskRetryCount). */
  return async ({ orgId, reportId }: ReportRun, delivery: { retryCount?: number } = {}): Promise<string> => {
    const runId = randomUUID();
    const claim = await data.claim(orgId, reportId, { runId, now: clock.now(), leaseUntil: lease() });
    if (claim.kind === 'done') return 'skipped';
    if (claim.kind === 'waiting') {
      // Delivered early (this may be the retry task itself, whose name is then used up): queue the run for retryAt
      // again under a name of this delivery's time, so an early delivery never leaves the report with no run queued.
      const now = clock.now();
      await queue.enqueue(reportTask(orgId, reportId, `wait-${claim.retryAt}-${now}`, claim.retryAt));
      return `skipped: waiting until ${claim.retryAt}`;
    }
    if (claim.kind === 'held') {
      // Another run holds the report. Should it have died, this check takes the report once its lease has run out.
      await queue.enqueue(reportTask(orgId, reportId, `lease-${claim.heldUntil}`, claim.heldUntil));
      return `skipped: held until ${claim.heldUntil}`;
    }
    try {
      return await run(orgId, claim.report, runId);
    } catch (err) {
      if (err instanceof ReportLeaseLost) return 'superseded';
      const deliveries = (delivery.retryCount ?? 0) + 1;
      deps.log?.error?.({ event: 'report.error', orgId, reportId, deliveries, err }, 'report.error');
      const last = deliveries >= REPORT_MAX_DELIVERIES;
      const done = await data
        .update(orgId, reportId, runId, {
          leaseUntil: null,
          ...(last ? { status: 'failed', error: failure('INTERNAL', REPORT_MESSAGES.internal, false) } : {}),
        })
        .then(() => last)
        .catch(() => false);
      if (done) return 'failed: INTERNAL';
      throw err;
    }
  };
}
