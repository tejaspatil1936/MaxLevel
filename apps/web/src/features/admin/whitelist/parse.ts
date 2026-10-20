import type { WhitelistRow } from '@mitaoe/shared';

/** A parsed sheet: the header row and the data rows, every cell as text. */
export interface Sheet {
  headers: string[];
  rows: string[][];
}

export class NotASheetError extends Error {}

/** Reads a CSV or XLSX file in the browser (DECISIONS Q11); nothing is uploaded until the mapped rows are saved. */
export async function parseSheet(file: File): Promise<Sheet> {
  const name = file.name.toLowerCase();
  let table: string[][];
  if (name.endsWith('.csv')) {
    const Papa = (await import('papaparse')).default;
    const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: 'greedy' });
    table = parsed.data.map((r) => r.map((c) => String(c ?? '')));
  } else if (name.endsWith('.xlsx')) {
    const ExcelJS = (await import('exceljs')).default;
    const book = new ExcelJS.Workbook();
    try {
      await book.xlsx.load(await file.arrayBuffer());
    } catch {
      throw new NotASheetError();
    }
    const sheet = book.worksheets[0];
    table = [];
    sheet?.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(row.getCell(c).text ?? '');
      table.push(cells);
    });
  } else {
    throw new NotASheetError();
  }
  const [headers = [], ...rows] = table.filter((r) => r.some((c) => c.trim() !== ''));
  return { headers: headers.map((h) => h.trim()), rows };
}

export interface Mapping {
  email: number;
  prn: number | null;
  note: number | null;
}

/** First header that looks like the field, for a sensible default mapping. */
export function guessMapping(headers: string[]): Mapping {
  const find = (re: RegExp) => {
    const i = headers.findIndex((h) => re.test(h));
    return i >= 0 ? i : null;
  };
  return { email: find(/e-?mail/i) ?? 0, prn: find(/\bprn\b/i), note: find(/note|remark|comment/i) };
}

export function mapRows(sheet: Sheet, m: Mapping): WhitelistRow[] {
  return sheet.rows.map((r) => {
    const prn = m.prn === null ? '' : (r[m.prn] ?? '').trim();
    const note = m.note === null ? '' : (r[m.note] ?? '').trim();
    return { email: r[m.email] ?? '', ...(prn ? { prn } : {}), ...(note ? { note } : {}) };
  });
}

/** Pasted lists hold one email per line. */
export function pastedRows(text: string): WhitelistRow[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((email) => ({ email }));
}
