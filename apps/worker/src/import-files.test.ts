import ExcelJS from 'exceljs';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { readCsv, readPdf, readXlsx, utf8Text } from './import-files';

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
    expect(readCsv(Buffer.from('﻿Question,Option A\n"Say ""hi"", then",x\n'))).toEqual([
      ['Question', 'Option A'],
      ['Say "hi", then', 'x'],
      [''],
    ]);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('First').addRows([
      ['Question', 'Option A'],
      ['What is 2 + 2?', 4],
    ]);
    wb.addWorksheet('Second').addRow(['ignored']);
    expect(await readXlsx(Buffer.from(await wb.xlsx.writeBuffer()))).toEqual([
      ['Question', 'Option A'],
      ['What is 2 + 2?', '4'],
    ]);
    expect(await readXlsx(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(60)]))).toBeNull();
    expect(utf8Text(Buffer.from('﻿abc'))).toBe('abc');
  });
});
