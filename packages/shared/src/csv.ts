// Spreadsheet-safe cells for every CSV and XLSX file the system writes (SEC-06): the browser's whitelist, student and
// audit exports and the worker's results exports (EXP-01, EXP-02) use these, so the rule lives in one place.

/** Leading characters a spreadsheet would read as the start of a formula. */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * A text cell with a leading single quote when a spreadsheet would run it as a formula (leading =, +, -, @, tab or
 * carriage return), so uploaded names, PRNs or notes can never carry a formula into an export.
 */
export function neutraliseFormula(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

/**
 * One CSV field, quoted when it holds a comma, quote or line break (RFC 4180). Text is neutralised; a finite number is
 * written as the number it is (`-0.5` stays a number, since it cannot hold a formula).
 */
export function csvField(v: unknown): string {
  const s =
    typeof v === 'number' && Number.isFinite(v)
      ? String(v)
      : neutraliseFormula(v === null || v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvLine = (values: ReadonlyArray<unknown>) => values.map(csvField).join(',');
