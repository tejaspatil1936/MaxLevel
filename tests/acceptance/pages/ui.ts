import { expect, type Download, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// Conventions shared by every phase 1 screen (docs/testids/phase-1.md, "Conventions").

export const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Exact-text matcher that tolerates surrounding whitespace only. */
export const exactly = (s: string) => new RegExp(`^\\s*${escapeRegExp(s)}\\s*$`);

/** The `redpen` colour every destructive confirm button uses as its background (UX-02). */
export const REDPEN = 'rgb(184, 50, 31)';

/** Formats a count the way the app shows numbers (en-IN grouping). */
export const count = (n: number) => new Intl.NumberFormat('en-IN').format(n);

/** A form field found by its exact label text, for example `Name (required)`. */
export function field(scope: Page | Locator, label: string): Locator {
  return scope.getByLabel(label, { exact: true });
}

/** The visible `<label>` element whose text is exactly `label` (A11Y-11: never placeholder-only). */
export function labelElement(scope: Page | Locator, label: string): Locator {
  return scope.locator('label').filter({ hasText: exactly(label) });
}

/** UX-09, A11Y-11: the error is shown, the field is marked invalid, and the error is the field's description. */
export async function expectFieldError(scope: Page | Locator, fieldLocator: Locator, message: string): Promise<void> {
  await expect(scope.getByText(message, { exact: true }).first()).toBeVisible();
  await expect(fieldLocator).toHaveAttribute('aria-invalid', 'true');
  await expect(fieldLocator).toHaveAccessibleDescription(new RegExp(escapeRegExp(message)));
}

/** The field carries no error. */
export async function expectNoFieldError(fieldLocator: Locator): Promise<void> {
  await expect(fieldLocator).not.toHaveAttribute('aria-invalid', 'true');
}

/** A modal dialog by exact name. */
export const dialog = (page: Page, name: string) => page.getByRole('dialog', { name, exact: true });

/** A confirmation dialog by exact name. */
export const alertDialog = (page: Page, name: string) => page.getByRole('alertdialog', { name, exact: true });

/** A button inside a dialog or region, by exact name. */
export const button = (scope: Page | Locator, name: string) => scope.getByRole('button', { name, exact: true });

/** The `Cancel` button of a dialog. */
export const cancelButton = (dlg: Locator) => button(dlg, 'Cancel');

/** The one-sentence-and-one-action empty state inside `scope` (UX-08). */
export const emptyState = (scope: Page | Locator) => scope.getByTestId('empty-state');

/** UX-08: the empty state says exactly `sentence` and offers exactly one action, named `action`. */
export async function expectEmptyState(scope: Page | Locator, sentence: string, action: string): Promise<void> {
  const empty = emptyState(scope);
  await expect(empty).toBeVisible();
  // One sentence and one action, nothing else (no illustration text, no second line).
  await expect(empty).toHaveText(new RegExp(`^\\s*${escapeRegExp(sentence)}\\s*${escapeRegExp(action)}\\s*$`));
  await expect(empty.getByText(sentence, { exact: true })).toBeVisible();
  const actions = empty.locator('button, a[href]');
  await expect(actions).toHaveCount(1);
  await expect(actions.first()).toHaveAccessibleName(action);
}

/**
 * UX-02: focus starts on Cancel, the confirm button sits to the right of Cancel and, for destructive actions, uses the
 * redpen background.
 */
export async function expectConfirmLayout(
  dlg: Locator,
  confirmName: string,
  destructive: boolean,
  opts: { focusOnCancel?: boolean } = {},
): Promise<void> {
  const cancel = dlg.getByRole('button', { name: 'Cancel', exact: true });
  const confirm = dlg.getByRole('button', { name: confirmName, exact: true });
  if (opts.focusOnCancel ?? true) await expect(cancel).toBeFocused();
  const [c, k] = await Promise.all([cancel.boundingBox(), confirm.boundingBox()]);
  expect(c && k, 'Cancel and confirm have boxes').toBeTruthy();
  expect(k!.x, `${confirmName} right of Cancel`).toBeGreaterThan(c!.x + c!.width - 1);
  if (destructive) {
    const bg = await confirm.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg, `${confirmName} background`).toBe(REDPEN);
  }
}

/** A table by exact name, and its rows that contain `text`. */
export const table = (scope: Page | Locator, name: string) => scope.getByRole('table', { name, exact: true });
export const rowWith = (tbl: Locator, text: string) => tbl.getByRole('row').filter({ hasText: text });

/** Data rows of a table (rows that hold cells rather than column headers). */
export const dataRows = (tbl: Locator) =>
  tbl.getByRole('row').filter({ has: tbl.page().getByRole('cell').or(tbl.page().getByRole('gridcell')) });

/** The cell of `row` under the column named `column` of `tbl`. */
export async function cellIn(tbl: Locator, row: Locator, column: string): Promise<Locator> {
  const headers = await tbl.getByRole('columnheader').allInnerTexts();
  const index = headers.findIndex((h) => h.trim() === column);
  expect(index, `column ${column} in ${JSON.stringify(headers)}`).toBeGreaterThanOrEqual(0);
  // Cells in document order, whether a cell is a data cell or a row header.
  return row.getByRole('cell').or(row.getByRole('rowheader')).or(row.getByRole('gridcell')).nth(index);
}

/** Text of a downloaded file. */
export async function downloadText(download: Download): Promise<string> {
  const path = await download.path();
  return readFile(path, 'utf8');
}

/** Opens a menu from its trigger button and returns the menu. */
export async function openMenu(page: Page, trigger: Locator): Promise<Locator> {
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  return menu;
}
