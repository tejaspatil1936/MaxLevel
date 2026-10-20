import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { readCsv, readPdf, readXlsx, utf8Text } from './import-files';
import { farCornerXlsx, sharedStringBombXlsx } from './test-support/hostile-files';

describe('import source readers', () => {
  it('IMP-02 a PDF gives its page count and each page as a one-page PDF; other bytes give null', async () => {
    const doc = await PDFDocument.create();
    for (let i = 0; i < 3; i++) doc.addPage([595, 842]);
    const pdf = await readPdf(await doc.save());
    expect(pdf?.pageCount).toBe(3);
    const page = await PDFDocument.load(await pdf!.page(2));
    expect(page.getPageCount()).toBe(1);
    expect(await readPdf(Buffer.from('%PDF-1.4 but nothing else'))).toBeNull();
  });

  it('IMP-01 CSV rows follow RFC 4180 and drop a BOM; the first XLSX worksheet is read as text', async () => {
    expect(readCsv(Buffer.from('﻿Question,Option A\n"Say ""hi"", then",x\n'))).toEqual({
      rows: [
        ['Question', 'Option A'],
        ['Say "hi", then', 'x'],
      ],
    });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('First').addRows([
      ['Question', 'Option A'],
      ['What is 2 + 2?', 4],
    ]);
    wb.addWorksheet('Second').addRow(['ignored']);
    expect(await readXlsx(Buffer.from(await wb.xlsx.writeBuffer()))).toEqual({
      rows: [
        ['Question', 'Option A'],
        ['What is 2 + 2?', '4'],
      ],
    });
    expect(await readXlsx(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60)]))).toBeNull();
    expect(utf8Text(Buffer.from('﻿abc'))).toBe('abc');
  });
});

/** The rows a reader kept, by their index (blank rows are not kept). */
const kept = (out: unknown) => Object.entries((out as { rows: string[][] }).rows);

describe('import source readers on hostile sheets', () => {
  it('SEC-06 IMP-02 an XLSX that unzips past 50 MB is refused before the workbook is loaded', async () => {
    const out: unknown = await readXlsx(sharedStringBombXlsx(60 * 1024 * 1024));
    expect(out).toEqual({ unzippedTooLarge: true });
  });

  it('SEC-06 a cell at XFD1048576 builds no grid: only rows with values, at most 64 columns, are read', async () => {
    const out: unknown = await readXlsx(await farCornerXlsx());
    expect(kept(out)).toEqual([['0', ['Question', ...Array<string>(63).fill('')]]]);
  });

  it('IMP-02 rows past 5,000 are counted, not kept, in CSV and XLSX', async () => {
    const rows = ['Question', ...Array.from({ length: 6000 }, (_, i) => `Q${i}`)];
    expect(readCsv(Buffer.from(rows.join('\n'))) as unknown).toEqual({ tooManyRows: 6000 });
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Questions').addRows(rows.map((r) => [r]));
    const out: unknown = await readXlsx(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(out).toEqual({ tooManyRows: 6000 });
  });

  it('IMP-02 blank CSV lines keep their row numbers without being stored', () => {
    const out: unknown = readCsv(Buffer.from('Question,Option A\n' + '\n'.repeat(1_000_000) + 'Q,1\n'));
    expect(kept(out)).toEqual([
      ['0', ['Question', 'Option A']],
      ['1000001', ['Q', '1']],
    ]);
  });
});
