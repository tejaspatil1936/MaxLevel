import { crc32, deflateRawSync } from 'node:zlib';
import ExcelJS from 'exceljs';
import { PDFDocument, PDFName } from 'pdf-lib';

// Hostile import files for the worker's tests (SEC-06): each is small on disk and built at test time, so nothing
// large is committed. Test use only.

/** A ZIP of the given entries, each deflated (method 8), with a correct central directory. */
export function zip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const file = Buffer.from(name, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(file.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(file.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, file, packed);
    centrals.push(central, file);
    offset += local.length + file.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
const xml = (s: string) => Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`);

/**
 * A one-sheet workbook whose only cell, A1, is a shared string of `sharedStringChars` letters: a few kilobytes
 * zipped, `sharedStringChars` bytes once unzipped (a "zip bomb" in `xl/sharedStrings.xml`).
 */
export function sharedStringBombXlsx(sharedStringChars: number): Buffer {
  return zip([
    {
      name: '[Content_Types].xml',
      data: xml(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="${CT}.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="${CT}.worksheet+xml"/>` +
          `<Override PartName="/xl/sharedStrings.xml" ContentType="${CT}.sharedStrings+xml"/></Types>`,
      ),
    },
    {
      name: '_rels/.rels',
      data: xml(
        `<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" ` +
          `Target="xl/workbook.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/workbook.xml',
      data: xml(
        `<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>` +
          `</workbook>`,
      ),
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: xml(
        `<Relationships xmlns="${PKG}">` +
          `<Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
          `<Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      ),
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      data: xml(
        `<worksheet xmlns="${NS}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>`,
      ),
    },
    {
      name: 'xl/sharedStrings.xml',
      data: Buffer.concat([
        xml(`<sst xmlns="${NS}" count="1" uniqueCount="1"><si><t>`),
        Buffer.alloc(sharedStringChars, 'a'),
        Buffer.from('</t></si></sst>'),
      ]),
    },
  ]);
}

/** A workbook with one cell at A1 and one at XFD1048576, the sheet's last row and widest column: under 10 KB. */
export async function farCornerXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Questions');
  ws.getCell('A1').value = 'Question';
  ws.getCell('XFD1048576').value = 'far';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A PDF of `pages` A4 pages whose page `broken` names itself as its parent: it loads and counts, but cannot be copied. */
export async function brokenPagePdf(pages: number, broken: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]);
  const page = doc.getPage(broken - 1);
  page.node.set(PDFName.of('Parent'), page.ref);
  return doc.save({ useObjectStreams: false });
}

/** A one-page PDF whose page is 14,400 points square, the largest a PDF page may be (200 inches). */
export async function hugePagePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([14_400, 14_400]);
  return doc.save();
}
