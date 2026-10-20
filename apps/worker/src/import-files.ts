import ExcelJS from 'exceljs';
import Papa from 'papaparse';
import { PDFDocument } from 'pdf-lib';
import { inflateRawSync } from 'node:zlib';
import { IMPORT_MAX_SHEET_ROWS } from '@mitaoe/shared';

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

/** What reading a sheet gave: its rows (blank ones left as holes), or how many rows it has past the limit. */
export type SheetRead = { rows: string[][] } | { tooManyRows: number };

/** Columns read from a sheet; further columns are ignored (the template has 14). */
export const SHEET_MAX_COLUMNS = 64;
/** The most an XLSX may hold once unzipped: ExcelJS keeps the whole workbook in memory. */
export const XLSX_MAX_UNZIPPED_BYTES = 50 * 1024 * 1024;

const isBlank = (cells: ReadonlyArray<string>) => cells.every((c) => c.trim() === '');

/**
 * Collects a sheet's rows as they are read, in order: blank rows stay holes, rows after the header are counted
 * (IMP-02), and no row is kept once the count passes IMPORT_MAX_SHEET_ROWS, so a long sheet costs no memory.
 */
function sheetCollector() {
  const rows: string[][] = [];
  let count = 0;
  return {
    add(index: number, cells: string[]) {
      if (isBlank(cells)) return;
      if (index > 0) count++;
      if (count <= IMPORT_MAX_SHEET_ROWS) rows[index] = cells;
    },
    result: (): SheetRead => (count > IMPORT_MAX_SHEET_ROWS ? { tooManyRows: count } : { rows }),
  };
}

/** A UTF-8 CSV (RFC 4180) as rows of cell text, read row by row. */
export function readCsv(bytes: Uint8Array): SheetRead {
  const sheet = sheetCollector();
  let index = 0;
  Papa.parse<string[]>(utf8Text(bytes), {
    skipEmptyLines: false,
    step: ({ data }) => {
      sheet.add(
        index++,
        data.slice(0, SHEET_MAX_COLUMNS).map((c) => String(c ?? '')),
      );
    },
  });
  return sheet.result();
}

/**
 * The bytes a ZIP's entries hold once inflated, inflating each one with a cap on its output so a lying header cannot
 * make it larger; `Infinity` past `cap`, null when it is not a ZIP this reader understands (no ZIP64, deflate or
 * stored entries only).
 */
export function unzippedSize(bytes: Uint8Array, cap: number): number | null {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end of central directory record: the last one, as JSZip (ExcelJS's reader) takes it.
  let end = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
    if (buf.readUInt32LE(i) === 0x06054b50) {
      end = i;
      break;
    }
  if (end < 0) return null;
  const entries = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  if (entries === 0xffff || p === 0xffffffff) return null;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const packed = buf.readUInt32LE(p + 20);
    const declared = buf.readUInt32LE(p + 24);
    const local = buf.readUInt32LE(p + 42);
    p += 46 + buf.readUInt16LE(p + 28) + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
    if (packed === 0xffffffff || declared === 0xffffffff || local === 0xffffffff) return null;
    if (total + declared > cap) return Infinity;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    if (start + packed > buf.length) return null;
    const data = buf.subarray(start, start + packed);
    if (method === 0) total += packed;
    else if (method === 8) {
      try {
        total += inflateRawSync(data, { maxOutputLength: cap - total + 1 }).length;
      } catch (err) {
        if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') return Infinity;
        return null;
      }
    } else return null;
    if (total > cap) return Infinity;
  }
  return total;
}

/**
 * The first worksheet of an XLSX workbook as rows of cell text; null when it is not a workbook. A workbook over
 * XLSX_MAX_UNZIPPED_BYTES once unzipped is refused before it is loaded; only the rows and cells that hold values are
 * visited, up to SHEET_MAX_COLUMNS columns, so a stray cell at XFD1048576 builds no grid.
 */
export async function readXlsx(bytes: Uint8Array): Promise<SheetRead | { unzippedTooLarge: true } | null> {
  const size = unzippedSize(bytes, XLSX_MAX_UNZIPPED_BYTES);
  if (size === null) return null;
  if (size > XLSX_MAX_UNZIPPED_BYTES) return { unzippedTooLarge: true };
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(Uint8Array.from(bytes).buffer);
  } catch {
    return null;
  }
  const ws = wb.worksheets[0];
  if (!ws) return { rows: [] };
  // `columnCount` walks every row, so it is read once.
  const width = Math.min(ws.columnCount, SHEET_MAX_COLUMNS);
  const sheet = sheetCollector();
  ws.eachRow({ includeEmpty: false }, (row, r) => {
    const cells = Array<string>(width).fill('');
    row.eachCell({ includeEmpty: false }, (cell, c) => {
      if (c <= width) cells[c - 1] = cell.text ?? '';
    });
    sheet.add(r - 1, cells);
  });
  return sheet.result();
}
