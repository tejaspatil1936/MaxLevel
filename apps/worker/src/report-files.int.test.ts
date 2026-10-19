import { computeSeriesMetrics, computeTestMetrics, type MetricsAttempt } from '@mitaoe/shared';
import ExcelJS from 'exceljs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { afterAll, describe, expect, it } from 'vitest';
import { chromiumPrinter, PrintTimeoutError, reportFontUrl } from './report-pdf';
import { renderReportHtml } from './report-render';
import { reportXlsx } from './report-xlsx';

// EXP-06: the report PDF printed by headless Chromium and the optional XLSX of raw statistics, read back as the
// acceptance tests read them (pdf.js and ExcelJS).

const printer = chromiumPrinter({
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
afterAll(() => printer.close());

const sat = (studentId: string, score: number, pick: string | null, strikes = 0): MetricsAttempt => ({
  studentId,
  departmentId: 'cs',
  status: 'submitted',
  score,
  durationSec: 600,
  strikesCount: strikes,
  sections: {},
  answers: { q1: pick },
  drawQuestionIds: ['q1'],
});
const metrics = computeTestMetrics({
  title: 'Day 1: Quantitative aptitude',
  maxScore: 1,
  eligible: 5,
  inProgress: 0,
  questions: [
    {
      id: 'q1',
      sectionId: null,
      options: [
        { id: 'a', text: '=HYPERLINK("x")' },
        { id: 'b', text: '20 m/s' },
      ],
      correctOptionIds: ['b'],
    },
  ],
  sections: [],
  departments: [{ id: 'cs', name: '=Computer' }],
  attempts: [sat('s1', 1, 'b'), sat('s2', 0, 'a', 2), sat('s3', 0, null)],
});

async function readPdf(bytes: Buffer) {
  const doc = await getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false }).promise;
  const info = (await doc.getMetadata()).info as Record<string, unknown>;
  const markInfo = await doc.getMarkInfo();
  const outline = ((await doc.getOutline()) ?? []).map((o) => o.title);
  let text = '';
  for (let n = 1; n <= doc.numPages; n++)
    for (const item of (await (await doc.getPage(n)).getTextContent()).items) text += 'str' in item ? item.str : '';
  await doc.destroy();
  return { info, markInfo, outline, text: text.replace(/\s+/g, '') };
}
const compact = (s: string) => s.replace(/\s+/g, '');

describe('report files', () => {
  it('EXP-06 headless Chromium prints the page to an A4 PDF with its title and every text, unprocessed', async () => {
    const html = renderReportHtml({
      metrics,
      orgName: 'MIT Academy of Engineering',
      timeZone: 'Asia/Kolkata',
      requestedAt: Date.UTC(2026, 9, 20, 6, 15),
      summary: { summary: 'One of the three students got question 1 right.', recommendations: ['Practise it.'] },
      fontUrl: await reportFontUrl(),
    });
    const pdf = await printer.print(html);
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const read = await readPdf(pdf);
    expect(String(read.info.Producer)).toMatch(/^Skia\/PDF/);
    expect(read.info.Title).toBe('Analytics report: Day 1: Quantitative aptitude');
    for (const line of [
      'Analytics report',
      'Generated 20 Oct 2026, 11:45 IST',
      'Written by AI from the statistics in this report.',
      'One of the three students got question 1 right.',
      'Students who finished: 3 of 5',
      'Question 1: A. =HYPERLINK("x"), picked 1 time',
      'Attempts with strikes: 1 of 3',
      'Median time taken: 10 minutes',
    ])
      expect(read.text, line).toContain(compact(line));
    expect(read.text, 'no running header or footer: only the page content').toMatch(
      /^Analyticsreport.*Mediantimetaken:10minutes$/,
    );
    expect(read.text).not.toContain('about:blank');
    expect(await reportFontUrl()).toMatch(/^data:font\/woff2;base64,/);
    expect(read.markInfo, 'a tagged PDF that screen readers can read').toMatchObject({ Marked: true });
    expect(read.outline, 'an outline from the headings').toContain('Day 1: Quantitative aptitude');
  });

  it('EXP-06 a page script never runs while printing, so a page that never finishes loading cannot hold it', async () => {
    const html = '<!doctype html><title>Loop</title><p>Printed without its script.</p><script>for (;;) {}</script>';
    const read = await readPdf(await printer.print(html));
    expect(read.text).toContain('Printedwithoutitsscript.');
  }, 15_000);

  it('EXP-06 a print that is not done in time fails with its timeout, and the printer prints again after it', async () => {
    const hurried = chromiumPrinter({
      ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
      timeoutMs: 1,
    });
    try {
      const html = '<!doctype html><title>Slow</title><p>Too slow.</p>';
      const failed = hurried.print(html);
      await expect(failed).rejects.toBeInstanceOf(PrintTimeoutError);
      await expect(failed).rejects.toThrow('The report print took longer than 1 ms.');
      expect((await printer.print(html)).subarray(0, 5).toString('latin1')).toBe('%PDF-');
    } finally {
      await hurried.close();
    }
  });

  it('EXP-06 the XLSX holds the raw statistics sheet by sheet, numbers as numbers and text formula-safe', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await reportXlsx(metrics)) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((s) => s.name)).toEqual(['Overview', 'Questions', 'Departments']);
    const rows = (name: string) =>
      (wb.getWorksheet(name)!.getSheetValues() as unknown[][]).filter(Boolean).map((r) => r.slice(1));
    expect(rows('Overview')[0]).toEqual(['Metric', 'Value']);
    expect(rows('Overview')).toContainEqual(['Participation (%)', 60]);
    expect(rows('Overview').at(-1)).toEqual(['Median time taken (minutes)', 10]);
    expect(rows('Questions')[1]).toEqual([1, 3, 2, 1, 33.33, 1, 'A. =HYPERLINK("x")', 1]);
    expect(rows('Departments')).toEqual([
      ['Department', 'Students who finished', 'Mean score', 'Mean (%)'],
      ["'=Computer", 3, 0.33, 33.33],
    ]);

    const series = computeSeriesMetrics({
      title: 'Placement 2026',
      eligible: 2,
      departments: [],
      tests: [
        {
          id: 't1',
          heading: '=Day 1',
          scheduledDate: '2026-11-01',
          windowStart: 0,
          maxScore: 1,
          attempts: [sat('s1', 1, null)],
        },
      ],
    });
    const sb = new ExcelJS.Workbook();
    await sb.xlsx.load((await reportXlsx(series)) as unknown as ArrayBuffer);
    expect(sb.worksheets.map((s) => s.name)).toEqual(['Overview', 'Departments', 'Trends']);
    expect((sb.getWorksheet('Trends')!.getSheetValues() as unknown[][]).filter(Boolean).map((r) => r.slice(1))).toEqual(
      [
        ['Test', 'Date', 'Students who finished', 'Mean score', 'Median score', 'Maximum score', 'Mean (%)'],
        ["'=Day 1", '1 Nov 2026', 1, 1, 1, 1, 100],
      ],
    );
  });
});
