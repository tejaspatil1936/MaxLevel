import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { PNG_1X1 } from './files';

// Sample import files built at test time (docs/testids/phase-6.md, "Formats and limits"), and the recorded model
// answers in tests/fixtures/llm/. Nothing here is a selector or a wait.

export interface ImportFile {
  name: string;
  contentType: string;
  bytes: Buffer;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One question as the model answers it (docs/testids/phase-6.md, "Model output schema"). */
export interface LlmQuestion {
  prompt: string;
  options: string[];
  correct: number[];
  explanation?: string;
  difficulty?: 'easy' | 'medium' | 'hard';
  section?: string;
  refersToFigure?: boolean;
  figure?: { box: Box; alt: string };
  box?: Box;
}

/** The mock model's script (POST /__test/llm). */
export interface LlmScript {
  pages?: Record<string, LlmQuestion[]>;
  usage?: { inputTokens: number; outputTokens: number };
  failures?: Record<string, number>;
  hold?: number[];
  /** Phase 7: what the model answers to report summaries (docs/testids/phase-7.md, "Test-only routes"). */
  report?: {
    /** In call order; the last repeats once the list is used up. */
    answers: ReportSummaryAnswer[];
    /** The next n report calls fail with a provider error (HTTP 503). */
    failures?: number;
  };
}

/** The model's answer to a report summary call (docs/testids/phase-7.md, "Summary and the number check"). */
export interface ReportSummaryAnswer {
  summary: string;
  recommendations: string[];
}

export interface LlmFixture {
  file: string;
  pages: Record<string, LlmQuestion[]>;
}

const LLM_DIR = new URL('../../fixtures/llm/', import.meta.url);

/** A recorded model answer from tests/fixtures/llm/<name>.json. */
export function llmFixture(name: 'quant-paper' | 'reasoning-notes' | 'free-sheet' | 'unsafe-markup'): LlmFixture {
  return JSON.parse(readFileSync(new URL(`${name}.json`, LLM_DIR), 'utf8')) as LlmFixture;
}

/** The prompt-injection sample of IMP-06 (tests/fixtures/llm/injection.txt). */
export const injectionText = () => readFileSync(new URL('injection.txt', LLM_DIR), 'utf8');

/** Every question of a fixture in source order (page, then position), as the drafts' `order` numbers them. */
export function fixtureQuestions(f: LlmFixture): Array<LlmQuestion & { page: number; order: number }> {
  const out: Array<LlmQuestion & { page: number; order: number }> = [];
  const pages = Object.keys(f.pages)
    .map(Number)
    .sort((a, b) => a - b);
  for (const page of pages) for (const q of f.pages[String(page)]!) out.push({ ...q, page, order: out.length + 1 });
  return out;
}

// ---------- a minimal PDF writer ----------

const PAGE_W = 595;
const PAGE_H = 842;

export interface PdfLine {
  text: string;
  /** Fractions of the page from the top-left corner. */
  x: number;
  y: number;
  size?: number;
}

const pdfText = (s: string) =>
  s
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');

/** A valid A4 PDF with one page per entry, each page holding these lines of Helvetica text. */
export function pdfBytes(pages: ReadonlyArray<ReadonlyArray<PdfLine>>): Buffer {
  const objects: string[] = [];
  const kids: number[] = [];
  // 1 catalog, 2 pages, 3 font; then a page and its content stream per page.
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  pages.forEach((lines, i) => {
    const pageObj = 4 + i * 2;
    const contentObj = pageObj + 1;
    kids.push(pageObj);
    const stream = lines
      .map((l) => {
        const size = l.size ?? 11;
        const x = (l.x * PAGE_W).toFixed(1);
        const y = (PAGE_H * (1 - l.y) - size).toFixed(1);
        return `BT /F1 ${size} Tf ${x} ${y} Td (${pdfText(l.text)}) Tj ET`;
      })
      .join('\n');
    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${pages.length} >>`;

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = Buffer.byteLength(out, 'latin1');
    out += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let n = 1; n < objects.length; n++) out += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** A PDF of `count` pages, each saying only `Page <n>`. */
export const plainPdf = (count: number) =>
  pdfBytes(Array.from({ length: count }, (_, i) => [{ text: `Page ${i + 1}`, x: 0.1, y: 0.1, size: 14 }]));

/** The paper of a fixture as a PDF: each question printed on its page at its box, options below it. */
export function fixturePdf(f: LlmFixture): Buffer {
  const count = Math.max(...Object.keys(f.pages).map(Number));
  const pages: PdfLine[][] = Array.from({ length: count }, () => []);
  for (const q of fixtureQuestions(f)) {
    const lines = pages[q.page - 1]!;
    const top = q.box?.y ?? 0.1;
    lines.push({ text: q.prompt || '(no text)', x: (q.box?.x ?? 0.08) + 0.01, y: top + 0.01 });
    q.options.forEach((o, i) =>
      lines.push({ text: `(${String.fromCharCode(97 + i)}) ${o}`, x: 0.12, y: top + 0.04 + i * 0.025 }),
    );
    if (q.figure) lines.push({ text: '[figure]', x: q.figure.box.x, y: q.figure.box.y });
  }
  return pdfBytes(pages);
}

// ---------- files of each format ----------

export const PDF_TYPE = 'application/pdf';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const file = (name: string, contentType: string, bytes: Buffer | string): ImportFile => ({
  name,
  contentType,
  bytes: typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes,
});

/** The three-page aptitude paper of tests/fixtures/llm/quant-paper.json. */
export const quantPaperPdf = () => file('quant-paper.pdf', PDF_TYPE, fixturePdf(llmFixture('quant-paper')));

/** The reasoning notes, as plain text or Markdown. */
export const reasoningNotes = (ext: 'txt' | 'md'): ImportFile => {
  const qs = fixtureQuestions(llmFixture('reasoning-notes'));
  const body = qs
    .map(
      (q, i) => `${i + 1}. ${q.prompt}\n${q.options.map((o, k) => `(${String.fromCharCode(97 + k)}) ${o}`).join(' ')}`,
    )
    .join('\n\n');
  const text = ext === 'md' ? `# Reasoning\n\n${body}\n` : `Reasoning\n\n${body}\n`;
  return file(`reasoning-notes.${ext}`, ext === 'md' ? 'text/markdown' : 'text/plain', text);
};

export type Rows = ReadonlyArray<ReadonlyArray<string>>;

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export const csvText = (rows: Rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';

export async function xlsxBytes(rows: Rows, sheetName = 'Questions'): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  for (const row of rows) sheet.addRow([...row]);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Two questions in the template columns (docs/testids/phase-6.md, "Template sheet"). */
export const TEMPLATE_ROWS: Rows = [
  ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct', 'Explanation', 'Difficulty'],
  ['What is 10% of 90?', '8', '9', '10', '11', 'B', '10 / 100 x 90 = 9.', 'easy'],
  ['What is 12 x 12?', '124', '144', '154', '164', 'b', '', 'Medium'],
];

/** What the template rows become: prompt, options, the correct option's text, difficulty. */
export const TEMPLATE_QUESTIONS = [
  { prompt: 'What is 10% of 90?', options: ['8', '9', '10', '11'], correct: '9', difficulty: 'easy' },
  { prompt: 'What is 12 x 12?', options: ['124', '144', '154', '164'], correct: '144', difficulty: 'medium' },
] as const;

/** A sheet whose columns are not the template's, so it goes to the model (free-sheet fixture). */
export const FREE_SHEET_ROWS: Rows = [
  ['Q', 'Choices', 'Answer'],
  ['Which is the largest planet in the solar system?', 'Mars; Jupiter; Venus; Earth', 'Jupiter'],
  ['What is the chemical symbol for sodium?', 'So; Sd; Na; S', 'Na'],
];

export const templateCsv = (name = 'template.csv') => file(name, 'text/csv', csvText(TEMPLATE_ROWS));
export const freeSheetCsv = (name = 'free-sheet.csv') => file(name, 'text/csv', csvText(FREE_SHEET_ROWS));
export const templateXlsx = async (name = 'template.xlsx') => file(name, XLSX_TYPE, await xlsxBytes(TEMPLATE_ROWS));

/** A template CSV with this many question rows after the header. */
export function templateCsvWithRows(count: number, name = 'many-rows.csv'): ImportFile {
  const rows: string[][] = [['Question', 'Option A', 'Option B', 'Correct']];
  for (let i = 1; i <= count; i++) rows.push([`What is ${i} + 1?`, String(i + 1), String(i + 2), 'A']);
  return file(name, 'text/csv', csvText(rows));
}

/** Questions in the project's own JSON format (phase 2, `mitaoe-questions/1`). */
export const JSON_QUESTIONS = [
  { prompt: 'What is 25% of 80?', options: ['15', '20', '25', '30'], correct: 'B', difficulty: 'easy' },
  { prompt: 'What is the square root of 144?', options: ['10', '11', '12', '13'], correct: 'C' },
] as const;

export const questionsJson = (name = 'questions.json') =>
  file(name, 'application/json', JSON.stringify({ format: 'mitaoe-questions/1', questions: JSON_QUESTIONS }, null, 2));

// ---------- files that must be refused ----------

/** A real PNG, whatever its name says. */
export const pngNamed = (name: string, contentType: string) => file(name, contentType, PNG_1X1);

/** A Windows executable header, whatever its name says. */
export const exeNamed = (name: string, contentType: string) =>
  file(name, contentType, Buffer.concat([Buffer.from('MZ'), Buffer.alloc(254, 0x90)]));

/** A Word document name (DOCX is not accepted, IMP-01); the bytes are a ZIP header. */
export const docxFile = () =>
  file(
    'notes.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60)]),
  );

/** 25 MB is 26,214,400 bytes (docs/testids/phase-6.md, "Formats and limits"). */
export const MAX_IMPORT_BYTES = 26_214_400;

/** A PDF one byte over the size limit (a valid header followed by padding). */
export function oversizePdf(name = 'big.pdf'): ImportFile {
  const head = plainPdf(1);
  return file(name, PDF_TYPE, Buffer.concat([head, Buffer.alloc(MAX_IMPORT_BYTES + 1 - head.length, 0x20)]));
}
