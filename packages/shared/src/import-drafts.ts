import type { Difficulty } from './draw';
import { isTemplateHeader } from './import-formats';
import { optionIdOf, type DraftInput } from './import-llm';
import type { ImportedQuestion } from './questions-json';

// Drafts read without the model, and the parts the model reads (docs/testids/phase-6.md "Template sheet"). Pure
// functions the worker calls on what it parsed; the API never calls them (SEC-06). Sheet rows are indexed from the
// header (row 1 at index 0); a blank row may be a hole in the array, as the worker leaves blank rows out.

/** TXT and MD go to the model in parts of at most this many characters, split at line breaks. */
export const IMPORT_TEXT_PART_CHARS = 12_000;
/** A sheet outside the template goes to the model in parts of this many rows (as CSV text). */
export const IMPORT_SHEET_PART_ROWS = 200;

/** The longest sheet cell an import reads: a question or an explanation (questionCreateSchema's limit). */
export const IMPORT_MAX_CELL_CHARS = 20_000;
/** The longest `Option A` to `Option F` cell of a template sheet (an option's limit). */
export const IMPORT_MAX_OPTION_CHARS = 5_000;

const blank = (cells: ReadonlyArray<string>) => cells.every((c) => c.trim() === '');
const DIFFICULTIES: readonly string[] = ['easy', 'medium', 'hard'];
const asDifficulty = (v: string | undefined): Difficulty | undefined => {
  const d = v?.trim().toLowerCase();
  return d && DIFFICULTIES.includes(d) ? (d as Difficulty) : undefined;
};

/** Non-empty rows after the header (the IMP-02 row limit counts these). */
export const sheetRowCount = (rows: ReadonlyArray<ReadonlyArray<string>>) =>
  rows.slice(1).filter((r) => !blank(r)).length;

/**
 * A template sheet's drafts, one per non-empty row; `sourcePage` is the row number (header = 1). Empty option cells
 * are dropped and the rest lettered a, b, … in order; `Correct` names the column letters (any case, comma-separated),
 * and a letter whose cell is empty names a missing option, so the checks flag it.
 */
export function templateRowsToDrafts(
  rows: ReadonlyArray<ReadonlyArray<string>>,
): DraftInput[] | { error: 'NOT_TEMPLATE' } {
  const header = rows[0] ?? [];
  if (!isTemplateHeader(header)) return { error: 'NOT_TEMPLATE' };
  const col = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const at = (row: ReadonlyArray<string>, name: string) => {
    const i = col(name);
    return i < 0 ? undefined : (row[i] ?? '');
  };
  const drafts: DraftInput[] = [];
  rows.forEach((row, index) => {
    if (index === 0 || blank(row)) return;
    const options: DraftInput['options'] = [];
    const idOfLetter = new Map<string, string>();
    'abcdef'.split('').forEach((letter) => {
      const text = at(row, `option ${letter}`);
      if (text === undefined || text.trim() === '') return;
      const id = optionIdOf(options.length);
      idOfLetter.set(letter, id);
      options.push({ id, text });
    });
    const letters = (at(row, 'correct') ?? '')
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter((l) => l !== '');
    const correctOptionIds = [...new Set(letters.map((l) => idOfLetter.get(l) ?? `missing-${l}`))];
    const draft: DraftInput = {
      order: drafts.length + 1,
      sourcePage: index + 1,
      prompt: at(row, 'question') ?? '',
      options,
      correctOptionIds,
      difficultySuggested: false,
      images: [],
    };
    const explanation = at(row, 'explanation');
    if (explanation && explanation.trim() !== '') draft.explanation = explanation;
    const difficulty = asDifficulty(at(row, 'difficulty'));
    if (difficulty) draft.difficulty = difficulty;
    const section = at(row, 'section');
    if (section && section.trim() !== '') draft.sectionName = section.trim();
    drafts.push(draft);
  });
  return drafts;
}

/**
 * The first sheet cell longer than an import can keep (IMP-02, SEC-06), in row then column order: a template sheet's
 * option cells may hold IMPORT_MAX_OPTION_CHARS characters, every other cell IMPORT_MAX_CELL_CHARS. The worker refuses
 * such a file before writing anything, so no draft or part can pass Firestore's 1 MiB document limit. `row` counts
 * from the header (row 1); null when every cell fits.
 */
export function sheetCellTooLong(rows: ReadonlyArray<ReadonlyArray<string>>): { row: number; max: number } | null {
  const header = rows[0] ?? [];
  const template = isTemplateHeader(header);
  const limits = header.map((h) =>
    template && /^option [a-f]$/.test(h.trim().toLowerCase()) ? IMPORT_MAX_OPTION_CHARS : IMPORT_MAX_CELL_CHARS,
  );
  for (const [index, row] of rows.entries()) {
    if (!row) continue;
    for (const [i, cell] of row.entries()) {
      const max = limits[i] ?? IMPORT_MAX_CELL_CHARS;
      if ((cell ?? '').length > max) return { row: index + 1, max };
    }
  }
  return null;
}

/** A JSON file's questions (parseQuestionJson) as drafts, all from page 1, difficulty as given. */
export function jsonQuestionsToDrafts(questions: ReadonlyArray<ImportedQuestion>): DraftInput[] {
  return questions.map((q, i) => {
    const draft: DraftInput = {
      order: i + 1,
      sourcePage: 1,
      prompt: q.prompt,
      options: q.options.map((text, k) => ({ id: optionIdOf(k), text })),
      correctOptionIds: [...new Set(q.correct)].sort((a, b) => a - b).map(optionIdOf),
      difficultySuggested: false,
      images: [],
    };
    if (q.explanation !== undefined && q.explanation.trim() !== '') draft.explanation = q.explanation;
    if (q.difficulty !== undefined) draft.difficulty = q.difficulty;
    return draft;
  });
}

const HEADING = /^#{1,6}\s/;

/**
 * TXT or MD text in parts of at most IMPORT_TEXT_PART_CHARS characters, split at line breaks; Markdown is split
 * before a heading where the part holds one after its first line. A single longer line is cut where it must.
 */
export function textParts(text: string, format: 'txt' | 'md', max = IMPORT_TEXT_PART_CHARS): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split(/(?<=\n)/);
  const parts: string[] = [];
  let current: string[] = [];
  let size = 0;
  const flush = (upTo = current.length) => {
    const part = current.slice(0, upTo).join('');
    if (part.trim() !== '') parts.push(part);
    current = current.slice(upTo);
    size = current.join('').length;
  };
  for (let line of lines) {
    while (line.length > max) {
      flush();
      parts.push(line.slice(0, max));
      line = line.slice(max);
    }
    if (size + line.length > max) {
      const heading = format === 'md' ? current.findLastIndex((l, i) => i > 0 && HEADING.test(l)) : -1;
      flush(heading > 0 ? heading : current.length);
      if (size + line.length > max) flush();
    }
    current.push(line);
    size += line.length;
  }
  flush();
  return parts;
}

const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** A sheet outside the template as CSV text parts of IMPORT_SHEET_PART_ROWS non-empty rows, each with the header. */
export function sheetParts(rows: ReadonlyArray<ReadonlyArray<string>>, perPart = IMPORT_SHEET_PART_ROWS): string[] {
  const header = rows[0] ?? [];
  // `filter` skips holes, so a blank row the reader left out costs nothing.
  const body = rows.slice(1).filter((r) => !blank(r));
  const line = (r: ReadonlyArray<string>) => r.map(csvCell).join(',');
  const parts: string[] = [];
  for (let i = 0; i < body.length; i += perPart)
    parts.push([header, ...body.slice(i, i + perPart)].map(line).join('\n') + '\n');
  return parts;
}

/**
 * A sheet row as the review screen shows it (IMP-11): one `<header>: <value>` line per cell that holds a value, in
 * column order; a column without a header is `Column <n>`.
 */
export function sheetRowText(header: ReadonlyArray<string>, row: ReadonlyArray<string>): string {
  const lines: string[] = [];
  for (let i = 0; i < Math.max(header.length, row.length); i++) {
    const value = row[i] ?? '';
    if (value.trim() === '') continue;
    lines.push(`${(header[i] ?? '').trim() || `Column ${i + 1}`}: ${value}`);
  }
  return lines.join('\n');
}

/** The text of each part sheetParts makes, for the review screen: its rows as sheetRowText, a blank line apart. */
export function sheetPartTexts(rows: ReadonlyArray<ReadonlyArray<string>>, perPart = IMPORT_SHEET_PART_ROWS): string[] {
  const header = rows[0] ?? [];
  const body = rows.slice(1).filter((r) => !blank(r));
  const texts: string[] = [];
  for (let i = 0; i < body.length; i += perPart)
    texts.push(
      body
        .slice(i, i + perPart)
        .map((r) => sheetRowText(header, r))
        .join('\n\n'),
    );
  return texts;
}
