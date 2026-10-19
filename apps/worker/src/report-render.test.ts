import { computeSeriesMetrics, computeTestMetrics, type MetricsAttempt } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { duration, generatedLine, REPORT_PAGE_TEXTS, renderReportHtml, type ReportPage } from './report-render';

// EXP-06: the printable page's text (docs/testids/phase-7.md "PDF text"), read here from the HTML Chromium prints.

const sat = (studentId: string, departmentId: string, score: number, pick: string | null): MetricsAttempt => ({
  studentId,
  departmentId,
  status: 'submitted',
  score,
  durationSec: 600,
  strikesCount: score === 0 ? 1 : 0,
  sections: {},
  answers: { q1: pick, q2: null },
  drawQuestionIds: ['q1', 'q2'],
});

const testMetrics = computeTestMetrics({
  title: 'Day 1: <b>Quantitative</b> aptitude',
  maxScore: 2,
  eligible: 4,
  inProgress: 0,
  questions: [
    {
      id: 'q1',
      sectionId: null,
      options: [
        { id: 'a', text: '24 m/s' },
        { id: 'b', text: '20 m/s' },
      ],
      correctOptionIds: ['b'],
    },
    { id: 'q2', sectionId: null, options: [{ id: 'c', text: '30' }], correctOptionIds: ['c'] },
  ],
  sections: [],
  departments: [
    { id: 'cs', name: 'Computer' },
    { id: 'it', name: 'IT' },
  ],
  attempts: [sat('s1', 'cs', 1, 'b'), sat('s2', 'cs', 2, 'b'), sat('s3', 'it', 0, 'a')],
});

const page = (over: Partial<ReportPage> = {}): ReportPage => ({
  metrics: testMetrics,
  orgName: 'MIT Academy of Engineering',
  timeZone: 'Asia/Kolkata',
  requestedAt: Date.UTC(2026, 9, 20, 6, 15),
  summary: { summary: 'Three students finished. <script>x</script>', recommendations: ['Revisit question 1.'] },
  ...over,
});

/** The page's visible text, one line per block, as a reader (or pdf.js) sees it. */
const text = (html: string) =>
  html
    .replace(/<head>[\s\S]*<\/head>/, '')
    .replace(/<\/(p|li|h1|h2|tr|td|th)>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

/** The selectors of the page's style rules that let long words break (`overflow-wrap: anywhere` or `break-word`). */
const wrapping = (html: string) => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';
  return [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
    .filter((m) => /overflow-wrap:\s*(anywhere|break-word)/.test(m[2]!))
    .flatMap((m) => m[1]!.split(',').map((x) => x.trim()));
};

describe('report page', () => {
  it('EXP-06 a test report holds its title, organization, time, summary and every statistics part', () => {
    const html = renderReportHtml(page());
    expect(html).toContain('<title>Analytics report: Day 1: &lt;b&gt;Quantitative&lt;/b&gt; aptitude</title>');
    expect(html, 'model and title text never become markup').not.toMatch(/<script>|<b>/);
    const lines = text(html);
    expect(lines.slice(0, 4)).toEqual([
      'Analytics report',
      'Day 1: <b>Quantitative</b> aptitude',
      'MIT Academy of Engineering',
      'Generated 20 Oct 2026, 11:45 IST',
    ]);
    expect(lines).toEqual(
      expect.arrayContaining([
        'Summary',
        REPORT_PAGE_TEXTS.aiNote,
        'Three students finished. <script>x</script>',
        'Recommendations',
        'Revisit question 1.',
        'Key figures',
        'Students who finished: 3 of 4',
        'Mean score: 1 / 2',
        'Median score: 1 / 2',
        'Top score: 2 / 2',
        'Bottom score: 0 / 2',
        'Score distribution',
        'Departments',
        'Computer: 2 students, mean 1.5 / 2',
        'IT: 1 student, mean 0 / 2',
        'Questions',
        'Most-missed questions',
        'Question 2: 0% correct',
        'Question 1: 66.67% correct',
        'Most-picked wrong options',
        'Question 1: A. 24 m/s, picked 1 time',
        'Strikes',
        'Attempts with strikes: 1 of 3',
        'Total strikes: 1',
        'Ended after strikes: 0',
        'Time taken',
        'Median time taken: 10 minutes',
      ]),
    );
    expect(lines).not.toContain('Trends across days');
    expect(lines).not.toContain('Sections');
    expect(lines).not.toContain(REPORT_PAGE_TEXTS.leftOut);
  });

  it('EXP-05 EXP-06 a rejected summary leaves the statistics and says the summary was left out', () => {
    const lines = text(renderReportHtml(page({ summary: null })));
    expect(lines).toContain('Summary');
    expect(lines).toContain(REPORT_PAGE_TEXTS.leftOut);
    expect(lines).not.toContain('Recommendations');
    expect(lines).not.toContain(REPORT_PAGE_TEXTS.aiNote);
    expect(lines).toContain('Students who finished: 3 of 4');
  });

  it('EXP-06 a series report shows totals and trends across days, without per-question parts', () => {
    const t = (id: string, heading: string, date: string, attempts: MetricsAttempt[]) => ({
      id,
      heading,
      scheduledDate: date,
      windowStart: 0,
      maxScore: 4,
      attempts,
    });
    const metrics = computeSeriesMetrics({
      title: 'Placement 2026',
      eligible: 10,
      departments: [{ id: 'cs', name: 'Computer' }],
      tests: [
        t('t2', 'Day 2: Logical reasoning', '2026-11-02', [sat('s1', 'cs', 3, null)]),
        t('t1', 'Day 1: Quantitative aptitude', '2026-11-01', [sat('s1', 'cs', 4, null), sat('s2', 'cs', 2, null)]),
      ],
    });
    const lines = text(renderReportHtml(page({ metrics })));
    expect(lines).toEqual(
      expect.arrayContaining([
        'Mean total: 4.5 / 8',
        'Median total: 4.5 / 8',
        'Top total: 7 / 8',
        'Bottom total: 2 / 8',
        'Trends across days',
        'Day 1: Quantitative aptitude: 2 students, mean 3 / 4',
        'Day 2: Logical reasoning: 1 student, mean 3 / 4',
        'Computer: 2 students, mean 4.5 / 8',
        'Attempts with strikes: 0 of 3',
      ]),
    );
    for (const absent of ['Questions', 'Most-missed questions', 'Most-picked wrong options'])
      expect(lines).not.toContain(absent);
  });

  it('EXP-06 times read in the organization timezone and durations in the phase 4 format', () => {
    expect(generatedLine(Date.UTC(2026, 10, 1, 18, 40), 'Asia/Kolkata')).toBe('Generated 2 Nov 2026, 00:10 IST');
    expect([duration(45), duration(60), duration(119), duration(600), duration(1)]).toEqual([
      '45 seconds',
      '1 minute',
      '1 minute',
      '10 minutes',
      '1 second',
    ]);
  });

  it('EXP-06 a long unbroken title, heading or table cell wraps inside the page instead of running past its edge', () => {
    const long = 'W'.repeat(120);
    const html = renderReportHtml(page({ metrics: { ...testMetrics, title: `Day 1: ${long}` } }));
    expect(text(html)[1]).toBe(`Day 1: ${long}`);
    const rules = wrapping(html);
    expect(rules).toEqual(expect.arrayContaining(['h1', 'h2', 'p', 'li']));
    expect(
      rules.filter((x) => /^td\b/.test(x)),
      'text cells of the tables',
    ).not.toEqual([]);
    expect(
      rules.filter((x) => /^th\b/.test(x)),
      'header cells of the tables',
    ).not.toEqual([]);
  });
});
