import { writeFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';

// Upload fixtures written at test time (whitelist CSV and XLSX files, a logo, a file of the wrong kind).

export type Rows = ReadonlyArray<ReadonlyArray<string>>;

const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** Writes a CSV file (header row first) and returns its path. */
export async function writeCsv(path: string, rows: Rows): Promise<string> {
  await writeFile(path, rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n', 'utf8');
  return path;
}

/** Writes an XLSX workbook with one sheet holding these rows (header row first) and returns its path. */
export async function writeXlsx(path: string, rows: Rows): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Students');
  for (const row of rows) sheet.addRow([...row]);
  await workbook.xlsx.writeFile(path);
  return path;
}

/** A 1 x 1 PNG image, for logo uploads. */
export const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

/** A small PDF: a file that is neither CSV nor XLSX, whatever its name says. */
export const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n',
);

/** Parses simple CSV text (quoted cells allowed) into rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ''));
}
