import type { ExportTable, ReportMetrics } from '@mitaoe/shared';
import { workbook } from './tasks/export';

// The report's optional XLSX of raw statistics (EXP-06; docs/testids/phase-7.md "XLSX sheets"): numbers as number
// cells, text through the same formula-neutralising rule as every export (SEC-06), sheet by sheet in this order:
// Overview, Questions (test reports), Departments, Trends (series reports).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** A yyyy-mm-dd date as `d MMM yyyy`. */
const day = (date: string) => {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1] ?? ''} ${y}`;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

/** The sheets of a report's XLSX, as tables (header row first). */
export function reportSheets(m: ReportMetrics): Array<{ name: string; table: ExportTable }> {
  const overview: ExportTable = {
    columns: ['Metric', 'Value'],
    rows: [
      ['Students eligible', m.participation.eligible],
      ['Students who finished', m.participation.finished],
      ['Participation (%)', m.participation.ratePct],
      ['Maximum score', m.maxScore],
      ['Mean score', m.scores.mean],
      ['Median score', m.scores.median],
      ['Top score', m.scores.top],
      ['Bottom score', m.scores.bottom],
      ['Standard deviation', m.scores.stdDev],
      ['Attempts with strikes', m.strikes.attemptsWithStrikes],
      ['Total strikes', m.strikes.total],
      ['Median time taken (minutes)', round2(m.timeTaken.medianSec / 60)],
    ],
  };
  const questions: ExportTable = {
    columns: [
      'Question',
      'Served',
      'Answered',
      'Correct',
      'Correct rate (%)',
      'Discrimination index',
      'Most-picked wrong option',
      'Times picked',
    ],
    rows: m.questions.map((q) => {
      const top = [...q.wrongPicks].sort((a, b) => b.count - a.count || (a.letter < b.letter ? -1 : 1))[0];
      return [
        q.number,
        q.served,
        q.answered,
        q.correct,
        q.correctRatePct,
        q.discriminationIndex,
        top ? `${top.letter}. ${top.text}` : null,
        top ? top.count : null,
      ];
    }),
  };
  const departments: ExportTable = {
    columns: ['Department', 'Students who finished', 'Mean score', 'Mean (%)'],
    rows: m.departments.map((d) => [d.name, d.finished, d.mean, d.meanPct]),
  };
  const trends: ExportTable = {
    columns: ['Test', 'Date', 'Students who finished', 'Mean score', 'Median score', 'Maximum score', 'Mean (%)'],
    rows: m.trends.map((t) => [t.heading, day(t.date), t.finished, t.mean, t.median, t.max, t.meanPct]),
  };
  return m.scope === 'test'
    ? [
        { name: 'Overview', table: overview },
        { name: 'Questions', table: questions },
        { name: 'Departments', table: departments },
      ]
    : [
        { name: 'Overview', table: overview },
        { name: 'Departments', table: departments },
        { name: 'Trends', table: trends },
      ];
}

/** The report's XLSX file. */
export const reportXlsx = (m: ReportMetrics): Promise<Buffer> => workbook(reportSheets(m));
