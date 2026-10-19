import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { PDFDocument } from 'pdf-lib';

// Parsers of import source files (SEC-06: only the worker parses a file, and only after its signature matched). Each
// returns null for a file it cannot read, which the import task reports as not a real file of its format.

const BOM = '﻿';

/** UTF-8 text without its BOM. */
export const utf8Text = (bytes: Uint8Array) => {
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.startsWith(BOM) ? text.slice(1) : text;
};

/** A PDF's page count and each page as a one-page PDF of its own (IMP-03 sends pages, not extracted text). */
export async function readPdf(
  bytes: Uint8Array,
): Promise<{ pageCount: number; page(n: number): Promise<Uint8Array> } | null> {
  let doc: PDFDocument;
  let pageCount: number;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    pageCount = doc.getPageCount();
  } catch {
    return null;
  }
  return {
    pageCount,
    async page(n) {
      const one = await PDFDocument.create();
      const [copied] = await one.copyPages(doc, [n - 1]);
      one.addPage(copied!);
      return one.save();
    },
  };
}

/** A UTF-8 CSV (RFC 4180) as rows of cell text. */
export function readCsv(bytes: Uint8Array): string[][] {
  const parsed = Papa.parse<string[]>(utf8Text(bytes), { skipEmptyLines: false });
  return parsed.data.map((row) => row.map((c) => String(c ?? '')));
}

/** The first worksheet of an XLSX workbook as rows of cell text; null when it is not a workbook. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][] | null> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Uint8Array.from(bytes).buffer);
  } catch {
    return null;
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cells: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) cells.push(row.getCell(c).text ?? '');
    rows.push(cells);
  }
  return rows;
}
