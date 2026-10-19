// What an import may be (IMP-01, IMP-02, SEC-06; docs/testids/phase-6.md "Formats and limits"). The format comes from
// the file name's extension; the bytes must then match it (the API checks the first 64 KB of the stored object on
// start, the worker again before parsing). Only the worker parses a file.

export const IMPORT_FORMATS = ['json', 'pdf', 'xlsx', 'csv', 'txt', 'md'] as const;
export type ImportFormat = (typeof IMPORT_FORMATS)[number];

/** 25 MB. */
export const IMPORT_MAX_BYTES = 26_214_400;
export const IMPORT_MAX_PDF_PAGES = 100;
/** Non-empty rows after the header, first worksheet. */
export const IMPORT_MAX_SHEET_ROWS = 5000;
/** How much of the stored object the API reads to check its signature. */
export const IMPORT_SIGNATURE_BYTES = 65_536;

/** The format of a file name's extension, ignoring case; null for any other extension or none. */
export function importFormatOf(filename: string): ImportFormat | null {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return (IMPORT_FORMATS as readonly string[]).includes(ext) ? (ext as ImportFormat) : null;
}

/** The format's name in messages: `PDF`, `XLSX`, … */
export const importFormatLabel = (format: ImportFormat) => format.toUpperCase();

/** Formats the model always reads, so they count as AI imports from the start (IMP-08). */
export const AI_IMPORT_FORMATS: readonly ImportFormat[] = ['pdf', 'txt', 'md'];
export const isAiFormat = (format: ImportFormat) => AI_IMPORT_FORMATS.includes(format);

/** True when the model reads the file: PDF, TXT, MD, and a sheet that is not a template sheet. */
export function usesModel(format: ImportFormat, isTemplateSheet: boolean): boolean {
  if (format === 'json') return false;
  if (format === 'xlsx' || format === 'csv') return !isTemplateSheet;
  return true;
}

/** Template columns, matched ignoring case and surrounding spaces. */
export const TEMPLATE_COLUMNS = [
  'Question',
  'Option A',
  'Option B',
  'Option C',
  'Option D',
  'Option E',
  'Option F',
  'Correct',
  'Explanation',
  'Difficulty',
  'Section',
  'Marks',
  'Negative marks',
  'Tags',
] as const;
const TEMPLATE_REQUIRED = ['question', 'option a', 'option b', 'correct'];

/** A header row is a template's when it has `Question`, `Option A`, `Option B` and `Correct`. */
export function isTemplateHeader(cells: ReadonlyArray<string>): boolean {
  const have = new Set(cells.map((c) => c.trim().toLowerCase()));
  return TEMPLATE_REQUIRED.every((c) => have.has(c));
}

const startsWith = (head: Uint8Array, sig: ReadonlyArray<number>) =>
  head.length >= sig.length && sig.every((b, i) => head[i] === b);
const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04
const BOM = [0xef, 0xbb, 0xbf];

/** UTF-8 (a sequence cut off at the end of `head` is allowed, as head may be a prefix) with no NUL byte. */
function isUtf8Text(head: Uint8Array): boolean {
  if (head.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(head, { stream: true });
    return true;
  } catch {
    return false;
  }
}

/** Whether the file's first bytes are what its format says (SEC-06). */
export function signatureMatches(format: ImportFormat, head: Uint8Array): boolean {
  switch (format) {
    case 'pdf':
      return startsWith(head, PDF);
    case 'xlsx':
      return startsWith(head, ZIP);
    case 'json': {
      if (!isUtf8Text(head)) return false;
      const body = startsWith(head, BOM) ? head.subarray(BOM.length) : head;
      const first = body.find((b) => b !== 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d);
      return first === 0x7b || first === 0x5b; // { or [
    }
    default:
      return isUtf8Text(head);
  }
}

const count = (n: number) => n.toLocaleString('en-IN');

/** The exact messages of the limits and checks, also the UI's text. */
export const IMPORT_MESSAGES = {
  unsupported: "This file type can't be imported. Use JSON, PDF, XLSX, CSV, TXT or MD.",
  tooLarge: 'This file is larger than 25 MB. Split it into smaller files.',
  mismatch: (format: ImportFormat) =>
    `This file isn't a real ${importFormatLabel(format)} file. Check the file and try again.`,
  tooManyPages: (pages: number) => `This PDF has ${count(pages)} pages. The limit is 100 pages.`,
  tooManyRows: (rows: number) => `This sheet has ${count(rows)} rows. The limit is 5,000 rows.`,
  limitReached: (max: number) =>
    `This month's AI import limit (${count(max)}) is used up. JSON files and template sheets can still be imported.`,
  aiOff: "AI import isn't included in your organization's plan. Use the template columns or a JSON file.",
  uploadMissing: 'Upload the file before starting the import.',
  invalidJson: "This JSON file isn't in a question format we can read. Check the file and try again.",
} as const;
