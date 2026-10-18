import {
  EXPORT_CONTENT_TYPES,
  exportCsv,
  neutraliseFormula,
  testBoardId,
  testExportTable,
  zoneShortName,
  type Clock,
  type ExportTable,
} from '@mitaoe/shared';
import ExcelJS from 'exceljs';
import { z } from 'zod';
import type { ExportData, ExportRecord, ExportTest } from '../export-data';
import type { FileStore } from '../firebase';

export const exportPayloadSchema = z.object({
  orgId: z.string().min(1).max(128),
  exportId: z.string().min(1).max(128),
});
export type ExportRun = z.infer<typeof exportPayloadSchema>;

/** An XLSX workbook of named sheets: numbers as number cells, everything else formula-safe text (SEC-06). */
async function workbook(sheets: ReadonlyArray<{ name: string; table: ExportTable }>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const { name, table } of sheets) {
    const ws = wb.addWorksheet(name);
    [table.columns, ...table.rows].forEach((cells, r) =>
      cells.forEach((v, c) => {
        if (v !== null) ws.getCell(r + 1, c + 1).value = typeof v === 'number' ? v : neutraliseFormula(v);
      }),
    );
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * /tasks/export (EXP-01 to EXP-03, REL-04): builds the requested test or series export from the stored attempts,
 * profiles and test board, saves it to Storage at the record's `filePath` and marks it `ready`. A ready or failed export
 * is left as it is, so a second run changes nothing; a test or series that no longer exists marks it `failed`.
 */
export function exportHandler(deps: { exports: ExportData; files?: FileStore; clock: Clock }) {
  const { exports: data, clock } = deps;

  /** One test's export table, its ranks from the stored test board. */
  async function testTable(orgId: string, test: ExportTest, timeZone: string) {
    const [attempts, board] = await Promise.all([
      data.listAttempts(orgId, test.id),
      data.boardRows(orgId, testBoardId(test.id)),
    ]);
    const students = await data.students(
      orgId,
      attempts.map((a) => a.studentId),
    );
    const ranks = new Map(board.map((r) => [r.studentId, r.rank]));
    const zone = zoneShortName(timeZone, clock.now());
    return { attempts, table: testExportTable({ sections: test.sections, attempts, students, ranks, timeZone, zone }) };
  }

  async function build(rec: ExportRecord): Promise<Buffer | null> {
    const timeZone = await data.timezone(rec.orgId);
    if (rec.scope === 'test') {
      const test = await data.getTest(rec.orgId, rec.refId);
      if (!test?.published) return null;
      const { table } = await testTable(rec.orgId, test, timeZone);
      return rec.format === 'csv' ? Buffer.from(exportCsv(table), 'utf8') : workbook([{ name: 'Results', table }]);
    }
    return null;
  }

  return async (run: ExportRun): Promise<'skipped' | 'stored' | 'failed'> => {
    const rec = await data.startExport(run.orgId, run.exportId, clock.now());
    if (!rec) return 'skipped';
    if (!deps.files) throw new Error('The export task needs a file store.');
    const body = await build(rec);
    if (!body) {
      await data.endExport(rec.orgId, rec.id, 'failed', clock.now());
      return 'failed';
    }
    await deps.files.save(rec.filePath, body, EXPORT_CONTENT_TYPES[rec.format]);
    await data.endExport(rec.orgId, rec.id, 'ready', clock.now());
    return 'stored';
  };
}
