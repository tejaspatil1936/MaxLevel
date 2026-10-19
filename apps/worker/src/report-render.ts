import { zoneShortName, type ReportMetrics } from '@mitaoe/shared';
import { createElement as h, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// The report's printable page (EXP-06; docs/testids/phase-7.md "PDF text"): a React template rendered to static HTML,
// which report-pdf.ts prints with headless Chromium. Numbers read as on screens (en-IN, at most two decimals); every
// text is a React text node, so titles, names and the model's summary can never become markup. No student appears.

export interface ReportPage {
  metrics: ReportMetrics;
  orgName: string;
  timeZone: string;
  /** When the report was requested. */
  requestedAt: number;
  /** The accepted summary and recommendations, or null when every answer was rejected. */
  summary: { summary: string; recommendations: string[] } | null;
  /** An `@font-face` source for Atkinson Hyperlegible Next (a data: URL), or none for the system sans-serif. */
  fontUrl?: string;
}

export const REPORT_PAGE_TEXTS = {
  heading: 'Analytics report',
  aiNote: 'Written by AI from the statistics in this report.',
  leftOut: 'The written summary was left out because it used numbers that are not in these statistics.',
} as const;

const scores = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
/** A number as screens show it: en-IN, at most two decimals, U+2212 for a minus. */
export const num = (n: number) => {
  const text = scores.format(Math.abs(n));
  return n < 0 && text !== '0' ? `−${text}` : text;
};
const plural = (n: number, one: string, many: string) => `${num(n)} ${n === 1 ? one : many}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `Generated 20 Oct 2026, 11:45 IST`: the request time in the organization's timezone. */
export function generatedLine(ms: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const date = `${Number(get('day'))} ${MONTHS[Number(get('month')) - 1]} ${get('year')}`;
  return `Generated ${date}, ${get('hour')}:${get('minute')} ${zoneShortName(timeZone, ms)}`;
}

/** The phase 4 time format: whole minutes (`10 minutes`, `1 minute`), or seconds under a minute (`45 seconds`). */
export const duration = (sec: number) =>
  sec < 60 ? plural(Math.floor(sec), 'second', 'seconds') : plural(Math.floor(sec / 60), 'minute', 'minutes');

/** The report's lines by part, in page order (the template lays them out; tests read them). */
export function reportLines(m: ReportMetrics) {
  const series = m.scope === 'series';
  const of = (v: number, max: number) => `${num(v)} / ${num(max)}`;
  const word = series ? 'total' : 'score';
  const cap = series ? 'Total' : 'Score';
  const finishedAttempts = m.statuses.submitted + m.statuses.autoSubmitted + m.statuses.terminated;
  return {
    keyFigures: [
      `Students who finished: ${num(m.participation.finished)} of ${num(m.participation.eligible)}`,
      `Mean ${word}: ${of(m.scores.mean, m.maxScore)}`,
      `Median ${word}: ${of(m.scores.median, m.maxScore)}`,
      `Top ${word}: ${of(m.scores.top, m.maxScore)}`,
      `Bottom ${word}: ${of(m.scores.bottom, m.maxScore)}`,
    ],
    distributionHeader: [`${cap} band`, 'Students'],
    distribution: m.scores.distribution.map((b) => [`${num(b.fromPct)}–${num(b.toPct)}%`, num(b.count)]),
    trends: m.trends.map(
      (t) => `${t.heading}: ${plural(t.finished, 'student', 'students')}, mean ${of(t.mean, t.max)}`,
    ),
    sections: m.sections.map((s) => `${s.name}: mean ${of(s.mean, s.max)}`),
    departments: m.departments.map(
      (d) => `${d.name}: ${plural(d.finished, 'student', 'students')}, mean ${of(d.mean, m.maxScore)}`,
    ),
    questions: m.questions.map((q) => [
      num(q.number),
      `${num(q.correctRatePct)}%`,
      q.discriminationIndex === null ? 'Not enough answers' : num(q.discriminationIndex),
    ]),
    mostMissed: m.mostMissed.map((q) => `Question ${num(q.number)}: ${num(q.correctRatePct)}% correct`),
    mostPickedWrong: m.mostPickedWrong.map(
      (w) => `Question ${num(w.number)}: ${w.letter}. ${w.text}, picked ${plural(w.count, 'time', 'times')}`,
    ),
    strikes: [
      `Attempts with strikes: ${num(m.strikes.attemptsWithStrikes)} of ${num(finishedAttempts)}`,
      `Total strikes: ${num(m.strikes.total)}`,
      `Ended after strikes: ${num(m.strikes.terminated)}`,
    ],
    timeTaken: [`Median time taken: ${duration(m.timeTaken.medianSec)}`],
  };
}

/** The page's style: fixed text, plus the font's data: URL; nothing from the report goes into it. */
const CSS = (fontUrl?: string) => `
${fontUrl ? `@font-face { font-family: Atkinson Hyperlegible Next; src: url(${fontUrl}); font-weight: 200 800; }` : ''}
@page { size: A4; margin: 18mm 16mm; }
* { box-sizing: border-box; }
html { color: #141a33; font: 10.5pt/1.5 Atkinson Hyperlegible Next, Liberation Sans, Arial, sans-serif;
  font-variant-ligatures: none; }
body { margin: 0; }
header { border-bottom: 2px solid #2e3fd1; padding-bottom: 8pt; margin-bottom: 14pt; }
.kicker { color: #2e3fd1; font-weight: 700; letter-spacing: 0.02em; margin: 0; }
h1 { font-size: 20pt; line-height: 1.2; margin: 2pt 0 6pt; }
h2 { font-size: 13pt; margin: 16pt 0 6pt; break-after: avoid; }
p { margin: 0 0 6pt; }
.muted, .note { color: #5a6178; }
.note { font-style: italic; }
ul, ol { margin: 0 0 6pt; padding-left: 16pt; }
li { margin: 0 0 3pt; break-inside: avoid; }
.summary { background: #e6e9fb; border-left: 3px solid #2e3fd1; padding: 8pt 10pt; }
table { border-collapse: collapse; width: 100%; margin: 0 0 6pt; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border-bottom: 1px solid #d3d9e2; padding: 3pt 6pt; text-align: left; }
.n { text-align: right; font-variant-numeric: tabular-nums; }
`;

const list = (items: string[]) =>
  h(
    'ul',
    null,
    items.map((t, i) => h('li', { key: i }, t)),
  );
const part = (heading: string, ...children: ReactNode[]) => h('section', null, h('h2', null, heading), ...children);
const table = (caption: string, header: string[], rows: string[][]) =>
  h(
    'table',
    { 'aria-label': caption },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        header.map((c, i) => h('th', { key: i, className: i ? 'n' : undefined }, c)),
      ),
    ),
    h(
      'tbody',
      null,
      rows.map((r, i) =>
        h(
          'tr',
          { key: i },
          r.map((c, j) => h('td', { key: j, className: j ? 'n' : undefined }, c)),
        ),
      ),
    ),
  );

/** The whole page as HTML; its `<title>` becomes the PDF's Title (`Analytics report: <title>`). */
export function renderReportHtml(page: ReportPage): string {
  const { metrics: m } = page;
  const lines = reportLines(m);
  const test = m.scope === 'test';
  const summary = page.summary
    ? [
        part(
          'Summary',
          h('p', { className: 'note' }, REPORT_PAGE_TEXTS.aiNote),
          h('p', { className: 'summary' }, page.summary.summary),
        ),
        part(
          'Recommendations',
          h(
            'ol',
            null,
            page.summary.recommendations.map((r, i) => h('li', { key: i }, r)),
          ),
        ),
      ]
    : [part('Summary', h('p', null, REPORT_PAGE_TEXTS.leftOut))];
  const body = h(
    'body',
    null,
    h(
      'header',
      null,
      h('p', { className: 'kicker' }, REPORT_PAGE_TEXTS.heading),
      h('h1', null, m.title),
      h('p', null, page.orgName),
      h('p', { className: 'muted' }, generatedLine(page.requestedAt, page.timeZone)),
    ),
    ...summary,
    part('Key figures', list(lines.keyFigures)),
    m.scope === 'series' ? part('Trends across days', list(lines.trends)) : null,
    part('Score distribution', table('Score distribution', lines.distributionHeader, lines.distribution)),
    m.sections.length ? part('Sections', list(lines.sections)) : null,
    part('Departments', list(lines.departments)),
    test
      ? part('Questions', table('Questions', ['Question', 'Correct rate', 'Discrimination index'], lines.questions))
      : null,
    test ? part('Most-missed questions', list(lines.mostMissed)) : null,
    test ? part('Most-picked wrong options', list(lines.mostPickedWrong)) : null,
    part('Strikes', list(lines.strikes)),
    part('Time taken', list(lines.timeTaken)),
  );
  const html = h(
    'html',
    { lang: 'en' },
    h(
      'head',
      null,
      h('meta', { charSet: 'utf-8' }),
      h('title', null, `${REPORT_PAGE_TEXTS.heading}: ${m.title}`),
      h('style', null, CSS(page.fontUrl)),
    ),
    body,
  );
  return `<!doctype html>${renderToStaticMarkup(html)}`;
}
