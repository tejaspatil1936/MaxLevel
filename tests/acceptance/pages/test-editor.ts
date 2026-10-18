import { expect, type Locator, type Page } from '@playwright/test';
import { box } from '../fixtures/layout';
import { EligibilityEditor } from './eligibility-editor';
import { fillTestDetails, type TestDetails } from './series-pages';
import { SettingsControls } from './settings-controls';
import { Shell } from './shell';
import { alertDialog, button, cellIn, dataRows, dialog, exactly, field, table } from './ui';

// The test editor, /admin/tests/edit/?id=<testId>, and its tabs (docs/testids/phase-2.md, "Test editor").

export type EditorTab = 'Questions' | 'Sections' | 'Marking and timers' | 'Settings' | 'Eligibility' | 'Preview';
export const EDITOR_TABS: readonly EditorTab[] = [
  'Questions',
  'Sections',
  'Marking and timers',
  'Settings',
  'Eligibility',
  'Preview',
];

export const PUBLISH_DISABLED_REASON = 'Approve the test before publishing it.';
export const APPROVAL_REFUSED = "This test can't be approved yet. Fix the items marked Failed.";

export const QUESTIONS_EMPTY = {
  sentence: 'No questions yet. Add the first question.',
  action: 'Add question',
} as const;
export const SECTIONS_EMPTY = {
  sentence: 'No sections. All questions are drawn from one pool.',
  action: 'Add section',
} as const;
export const PREVIEW_EMPTY = {
  sentence: 'This test has no approved questions yet. Add questions to preview it.',
  action: 'Go to questions',
} as const;
export const INVALID_JSON = "This file isn't valid question JSON. Check it against the import format.";

export const SECTION_ERRORS = {
  name: 'Enter the section name.',
  drawTooLarge: (m: number, n: number) => `This section has ${m} approved questions, so it can't draw ${n}.`,
  mixTooLarge: (m: number, difficulty: string, n: number) =>
    `This section has ${m} ${difficulty} ${m === 1 ? 'question' : 'questions'}, so the mix can't take ${n}.`,
  testDrawTooLarge: (m: number, n: number) => `This test has ${m} approved questions, so it can't draw ${n}.`,
} as const;

export const MARKING_ERRORS = {
  marks: 'Enter a number greater than 0.',
  negative: 'Enter 0 or a positive number.',
  seconds: 'Enter a whole number of seconds, 1 or more.',
} as const;

/** Marking presets; the minus sign is U+2212 by contract, an ASCII hyphen is tolerated here. */
export const MARKING_PRESET = {
  p1_0: /^\+1 and 0$/,
  p1_m025: /^\+1 and [−-]0\.25$/,
  p4_m1: /^\+4 and [−-]1$/,
  custom: /^Custom$/,
} as const;

export class TestEditorPage {
  readonly shell: Shell;
  readonly h1: Locator;
  readonly status: Locator;
  readonly publish: Locator;
  readonly editDetails: Locator;
  readonly tablist: Locator;

  constructor(readonly page: Page) {
    this.shell = new Shell(page);
    const main = this.shell.main;
    this.h1 = this.shell.h1;
    this.status = main.getByTestId('test-status');
    this.publish = button(main, 'Publish test');
    this.editDetails = button(main, 'Edit details');
    this.tablist = main.getByRole('tablist');
  }

  static url(testId: string): string {
    return `/admin/tests/edit/?id=${encodeURIComponent(testId)}`;
  }

  async goto(testId: string, heading: string): Promise<void> {
    await this.page.goto(TestEditorPage.url(testId));
    await this.expectShown(heading);
  }

  async expectShown(heading: string): Promise<void> {
    await expect(this.shell.heading(heading)).toBeVisible();
    await expect(this.tablist).toBeVisible();
  }

  /** The schedule line, for example `Scheduled 2 Nov 2026, 10:00 to 11:00 IST`. */
  schedule(text: string): Locator {
    return this.shell.main.getByText(text, { exact: true });
  }

  tab(name: EditorTab): Locator {
    return this.tablist.getByRole('tab', { name, exact: true });
  }

  panel(name: EditorTab): Locator {
    return this.page.getByRole('tabpanel', { name, exact: true });
  }

  async openTab(name: EditorTab): Promise<Locator> {
    await this.tab(name).click();
    await expect(this.tab(name)).toHaveAttribute('aria-selected', 'true');
    const panel = this.panel(name);
    await expect(panel).toBeVisible();
    return panel;
  }

  /** The `status` notice with this exact text. */
  notice(text: string): Locator {
    return this.page.getByRole('status').filter({ hasText: exactly(text) });
  }

  async editDetailsWith(d: TestDetails): Promise<void> {
    await this.editDetails.click();
    const dlg = dialog(this.page, 'Edit test details');
    await expect(dlg).toBeVisible();
    await fillTestDetails(dlg, d);
    await button(dlg, 'Save details').click();
    await expect(dlg).toBeHidden();
  }

  async questions(): Promise<QuestionsTab> {
    return new QuestionsTab(this.page, await this.openTab('Questions'));
  }
  async sections(): Promise<SectionsTab> {
    return new SectionsTab(this.page, await this.openTab('Sections'));
  }
  async marking(): Promise<MarkingTab> {
    return new MarkingTab(this.page, await this.openTab('Marking and timers'));
  }
  async settings(): Promise<SettingsTab> {
    return new SettingsTab(this.page, await this.openTab('Settings'));
  }
  async eligibility(): Promise<EligibilityTab> {
    return new EligibilityTab(this.page, await this.openTab('Eligibility'));
  }
  async preview(): Promise<PreviewTab> {
    return new PreviewTab(this.page, await this.openTab('Preview'));
  }

  /** Presses Publish test and waits for the `Test published` notice (UX-10). */
  async publishTest(): Promise<void> {
    await expect(this.publish).toBeEnabled();
    await this.publish.click();
    await expect(this.notice('Test published')).toBeVisible();
  }
}

/** The sticky footer bar of a form tab. */
class FormFooter {
  readonly region: Locator;
  readonly discard: Locator;
  readonly unsaved: Locator;
  constructor(page: Page) {
    this.region = page.getByRole('region', { name: 'Form actions', exact: true });
    this.discard = button(this.region, 'Discard');
    this.unsaved = this.region.getByRole('status').filter({ hasText: exactly('Unsaved changes') });
  }
  save(name: string): Locator {
    return button(this.region, name);
  }
}

export class QuestionsTab {
  readonly add: Locator;
  readonly importJson: Locator;
  readonly list: Locator;
  readonly items: Locator;

  constructor(
    readonly page: Page,
    readonly panel: Locator,
  ) {
    this.add = button(panel, 'Add question').first();
    this.importJson = button(panel, 'Import JSON');
    this.list = panel.getByRole('list', { name: 'Questions', exact: true });
    this.items = this.list.getByRole('listitem');
  }

  /** The list item at position n (1-based). */
  item(n: number): Locator {
    return this.items.nth(n - 1);
  }

  editButton(n: number): Locator {
    return this.list.getByRole('button', { name: `Edit question ${n}`, exact: true });
  }

  deleteButton(n: number): Locator {
    return this.list.getByRole('button', { name: `Delete question ${n}`, exact: true });
  }

  handle(n: number): Locator {
    return this.list.getByRole('button', { name: `Reorder question ${n}`, exact: true });
  }

  /** Fails unless the list shows exactly these prompt fragments, in this order. */
  async expectOrder(fragments: readonly string[]): Promise<void> {
    await expect(this.items).toHaveCount(fragments.length);
    for (const [i, text] of fragments.entries()) await expect(this.item(i + 1)).toContainText(text);
  }

  async openAdd(): Promise<QuestionEditor> {
    await this.add.click();
    const editor = new QuestionEditor(this.page, 'Add question');
    await expect(editor.dialog).toBeVisible();
    return editor;
  }

  async openEdit(n: number): Promise<QuestionEditor> {
    await this.editButton(n).click();
    const editor = new QuestionEditor(this.page, `Edit question ${n}`);
    await expect(editor.dialog).toBeVisible();
    return editor;
  }

  async deleteQuestion(n: number): Promise<void> {
    await this.deleteButton(n).click();
    const dlg = alertDialog(this.page, `Delete question ${n}?`);
    await expect(dlg).toBeVisible();
    await button(dlg, 'Delete question').click();
    await expect(dlg).toBeHidden();
  }

  /** Q-01: drags question `from` by its handle onto the position of question `to` with the pointer. */
  async drag(from: number, to: number): Promise<void> {
    const src = await box(this.handle(from));
    const dst = await box(this.item(to));
    const [sx, sy] = [src.x + src.width / 2, src.y + src.height / 2];
    await this.page.mouse.move(sx, sy);
    await this.page.mouse.down();
    await this.page.mouse.move(sx, sy + (to > from ? 8 : -8), { steps: 4 });
    const ty = to > from ? dst.y + dst.height * 0.75 : dst.y + dst.height * 0.25;
    await this.page.mouse.move(dst.x + dst.width / 2, ty, { steps: 20 });
    await this.page.mouse.up();
  }

  /** Q-01: moves question n by `places` (positive = down) with the keyboard: Space, arrows, Space. */
  async keyboardMove(n: number, places: number): Promise<void> {
    await this.handle(n).focus();
    await this.page.keyboard.press('Space');
    for (let i = 0; i < Math.abs(places); i++) await this.page.keyboard.press(places > 0 ? 'ArrowDown' : 'ArrowUp');
    await this.page.keyboard.press('Space');
  }

  async openImport(): Promise<JsonImportDialog> {
    await this.importJson.click();
    const dlg = new JsonImportDialog(this.page);
    await expect(dlg.dialog).toBeVisible();
    return dlg;
  }
}

export interface QuestionInput {
  prompt?: string;
  options?: readonly string[];
  /** Letter of the correct option. */
  correct?: string;
  explanation?: string;
  difficulty?: 'Not set' | 'Easy' | 'Medium' | 'Hard';
  section?: string;
  marks?: string;
  negativeMarks?: string;
  timeLimit?: string;
}

export class QuestionEditor {
  readonly dialog: Locator;
  readonly prompt: Locator;
  readonly options: Locator;
  readonly addOption: Locator;
  readonly correct: Locator;
  readonly explanation: Locator;
  readonly difficulty: Locator;
  readonly section: Locator;
  readonly marks: Locator;
  readonly negativeMarks: Locator;
  readonly timeLimit: Locator;
  readonly tags: Locator;
  readonly addImage: Locator;
  readonly studentView: Locator;
  readonly problems: Locator;
  readonly save: Locator;

  constructor(
    readonly page: Page,
    readonly name: string,
  ) {
    this.dialog = dialog(page, name);
    const d = this.dialog;
    this.prompt = field(d, 'Question text');
    this.options = d.getByRole('group', { name: 'Options', exact: true });
    this.addOption = button(d, 'Add option');
    this.correct = d.getByRole('radiogroup', { name: 'Correct answer', exact: true });
    this.explanation = field(d, 'Explanation');
    this.difficulty = field(d, 'Difficulty');
    this.section = field(d, 'Section');
    this.marks = d.getByRole('spinbutton', { name: 'Marks', exact: true });
    this.negativeMarks = d.getByRole('spinbutton', { name: 'Negative marks', exact: true });
    this.timeLimit = d.getByRole('spinbutton', { name: 'Time limit (seconds)', exact: true });
    this.tags = field(d, 'Topic tags');
    this.addImage = field(d, 'Add image');
    this.studentView = d.getByRole('region', { name: 'Student view', exact: true });
    this.problems = d.getByRole('list', { name: 'Needs attention', exact: true });
    this.save = button(d, 'Save question');
  }

  option(letter: string): Locator {
    return field(this.dialog, `Option ${letter}`);
  }

  correctRadio(letter: string): Locator {
    return this.correct.getByRole('radio', { name: letter, exact: true });
  }

  altText(n: number): Locator {
    return field(this.dialog, `Alt text for image ${n}`);
  }

  problem(text: string): Locator {
    return this.problems.getByRole('listitem').filter({ hasText: exactly(text) });
  }

  /** `<math>` elements (KaTeX MathML) in the student view. */
  get math(): Locator {
    return this.studentView.locator('math');
  }

  /** The TeX source annotations of the student view's MathML. */
  get texAnnotations(): Locator {
    return this.studentView.locator('math annotation[encoding="application/x-tex"]');
  }

  get codeBlocks(): Locator {
    return this.studentView.locator('pre code');
  }

  image(alt: string): Locator {
    return this.studentView.getByRole('img', { name: alt, exact: true });
  }

  async fill(q: QuestionInput): Promise<void> {
    if (q.prompt !== undefined) await this.prompt.fill(q.prompt);
    if (q.options)
      for (const [i, text] of q.options.entries()) await this.option(String.fromCharCode(65 + i)).fill(text);
    if (q.correct) await this.correctRadio(q.correct).check();
    if (q.explanation !== undefined) await this.explanation.fill(q.explanation);
    if (q.difficulty) await this.difficulty.selectOption({ label: q.difficulty });
    if (q.section) await this.section.selectOption({ label: q.section });
    if (q.marks !== undefined) await this.marks.fill(q.marks);
    if (q.negativeMarks !== undefined) await this.negativeMarks.fill(q.negativeMarks);
    if (q.timeLimit !== undefined) await this.timeLimit.fill(q.timeLimit);
  }

  async saveAndClose(): Promise<void> {
    await this.save.click();
    await expect(this.dialog).toBeHidden();
  }
}

export class JsonImportDialog {
  readonly dialog: Locator;
  readonly file: Locator;
  readonly summary: Locator;
  readonly submit: Locator;

  constructor(readonly page: Page) {
    this.dialog = dialog(page, 'Import questions from JSON');
    this.file = field(this.dialog, 'JSON file (required)');
    this.summary = this.dialog.getByRole('list', { name: 'Import summary', exact: true });
    this.submit = button(this.dialog, 'Import questions');
  }

  summaryItem(text: string): Locator {
    return this.summary.getByRole('listitem').filter({ hasText: exactly(text) });
  }
}

export interface SectionInput {
  name?: string;
  instructions?: string;
  durationMin?: string;
  drawCount?: string;
  forwardOnly?: boolean;
  mix?: { easy?: string; medium?: string; hard?: string };
}

export type SectionColumn = 'Order' | 'Name' | 'Questions' | 'Draw' | 'Difficulty mix' | 'Duration' | 'Navigation';

export class SectionsTab {
  readonly add: Locator;
  readonly list: Locator;
  readonly rows: Locator;
  readonly wholeTestHeading: Locator;
  readonly wholeTestDraw: Locator;
  readonly saveDraw: Locator;

  constructor(
    readonly page: Page,
    readonly panel: Locator,
  ) {
    this.add = button(panel, 'Add section').first();
    this.list = table(panel, 'Sections');
    this.rows = dataRows(this.list);
    this.wholeTestHeading = panel.getByRole('heading', { level: 2, name: 'Whole-test draw', exact: true });
    this.wholeTestDraw = panel.getByRole('spinbutton', { name: 'Questions to draw', exact: true });
    this.saveDraw = button(panel, 'Save draw');
  }

  row(name: string): Locator {
    return this.list.getByRole('row').filter({
      has: this.page
        .getByRole('cell', { name, exact: true })
        .or(this.page.getByRole('rowheader', { name, exact: true })),
    });
  }

  async cell(name: string, column: SectionColumn): Promise<Locator> {
    return cellIn(this.list, this.row(name), column);
  }

  /** Section names in table order. */
  async names(): Promise<string[]> {
    const out: string[] = [];
    const n = await this.rows.count();
    for (let i = 0; i < n; i++)
      out.push((await (await cellIn(this.list, this.rows.nth(i), 'Name')).innerText()).trim());
    return out;
  }

  async choose(name: string, item: 'Edit' | 'Move up' | 'Move down' | 'Delete'): Promise<void> {
    await this.list.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
    await this.page.getByRole('menu').getByRole('menuitem', { name: item, exact: true }).click();
  }

  async openAdd(): Promise<SectionDialog> {
    await this.add.click();
    const dlg = new SectionDialog(this.page, 'Add section');
    await expect(dlg.dialog).toBeVisible();
    return dlg;
  }

  async openEdit(name: string): Promise<SectionDialog> {
    await this.choose(name, 'Edit');
    const dlg = new SectionDialog(this.page, `Edit ${name}`);
    await expect(dlg.dialog).toBeVisible();
    return dlg;
  }
}

export class SectionDialog {
  readonly dialog: Locator;
  readonly name: Locator;
  readonly instructions: Locator;
  readonly duration: Locator;
  readonly draw: Locator;
  readonly forwardOnly: Locator;
  readonly mix: Locator;
  readonly save: Locator;

  constructor(
    readonly page: Page,
    title: string,
  ) {
    this.dialog = dialog(page, title);
    const d = this.dialog;
    this.name = field(d, 'Name (required)');
    this.instructions = field(d, 'Instructions');
    this.duration = d.getByRole('spinbutton', { name: 'Duration (minutes)', exact: true });
    this.draw = d.getByRole('spinbutton', { name: 'Questions to draw', exact: true });
    this.forwardOnly = d.getByRole('checkbox', { name: 'Forward-only navigation', exact: true });
    this.mix = d.getByRole('group', { name: 'Difficulty mix', exact: true });
    this.save = button(d, 'Save section');
  }

  mixField(difficulty: 'Easy' | 'Medium' | 'Hard'): Locator {
    return this.mix.getByRole('spinbutton', { name: difficulty, exact: true });
  }

  async fill(s: SectionInput): Promise<void> {
    if (s.name !== undefined) await this.name.fill(s.name);
    if (s.instructions !== undefined) await this.instructions.fill(s.instructions);
    if (s.durationMin !== undefined) await this.duration.fill(s.durationMin);
    if (s.drawCount !== undefined) await this.draw.fill(s.drawCount);
    if (s.forwardOnly !== undefined) await this.forwardOnly.setChecked(s.forwardOnly);
    if (s.mix?.easy !== undefined) await this.mixField('Easy').fill(s.mix.easy);
    if (s.mix?.medium !== undefined) await this.mixField('Medium').fill(s.mix.medium);
    if (s.mix?.hard !== undefined) await this.mixField('Hard').fill(s.mix.hard);
  }

  async saveAndClose(): Promise<void> {
    await this.save.click();
    await expect(this.dialog).toBeHidden();
  }
}

export class MarkingTab {
  readonly scheme: Locator;
  readonly marks: Locator;
  readonly negative: Locator;
  readonly timeLimit: Locator;
  readonly seconds: Locator;
  readonly footer: FormFooter;
  readonly save: Locator;

  constructor(
    readonly page: Page,
    readonly panel: Locator,
  ) {
    this.scheme = panel.getByRole('radiogroup', { name: 'Marking scheme', exact: true });
    this.marks = panel.getByRole('spinbutton', { name: 'Marks for a correct answer', exact: true });
    this.negative = panel.getByRole('spinbutton', { name: 'Marks taken off for a wrong answer', exact: true });
    this.timeLimit = panel.getByRole('radiogroup', { name: 'Time limit per question', exact: true });
    this.seconds = panel.getByRole('spinbutton', { name: 'Seconds per question', exact: true });
    this.footer = new FormFooter(page);
    this.save = this.footer.save('Save marking and timers');
  }

  preset(p: keyof typeof MARKING_PRESET): Locator {
    return this.scheme.getByRole('radio', { name: MARKING_PRESET[p] });
  }

  limit(option: 'No time limit' | 'Same limit for every question' | 'Set on each question'): Locator {
    return this.timeLimit.getByRole('radio', { name: option, exact: true });
  }

  async saveAndConfirm(): Promise<void> {
    await this.save.click();
    await expect(this.page.getByRole('status').filter({ hasText: exactly('Marking and timers saved') })).toBeVisible();
  }
}

/** One setting of the Settings tab: an inherited or overridden group (TST-03). */
export class InheritedSetting {
  readonly group: Locator;
  readonly inherited: Locator;
  readonly overridden: Locator;
  readonly overrideSwitch: Locator;
  readonly reset: Locator;
  readonly controls: SettingsControls;

  constructor(
    readonly page: Page,
    panel: Locator,
    readonly label: string,
  ) {
    this.group = panel.getByRole('group', { name: label, exact: true });
    this.inherited = this.group.getByText('Inherited', { exact: true });
    this.overridden = this.group.getByText('Overridden', { exact: true });
    this.overrideSwitch = this.group.getByRole('switch', { name: `Override ${label}`, exact: true });
    this.reset = this.group
      .getByRole('button', { name: `Use series value for ${label}`, exact: true })
      .or(this.group.getByRole('link', { name: `Use series value for ${label}`, exact: true }));
    this.controls = new SettingsControls(page, this.group);
  }

  fromSeries(value: string): Locator {
    return this.group.getByText(`From series: ${value}`, { exact: true });
  }

  /** A labelled field inside the group, for example `Window start`. */
  input(label: string): Locator {
    return field(this.group, label);
  }

  async expectInherited(value: string): Promise<void> {
    await expect(this.inherited).toBeVisible();
    await expect(this.overridden).toHaveCount(0);
    await expect(this.fromSeries(value)).toBeVisible();
    await expect(this.overrideSwitch).not.toBeChecked();
    await expect(this.reset).toHaveCount(0);
  }

  async expectOverridden(): Promise<void> {
    await expect(this.overridden).toBeVisible();
    await expect(this.inherited).toHaveCount(0);
    await expect(this.overrideSwitch).toBeChecked();
    await expect(this.reset).toBeVisible();
  }

  async override(): Promise<void> {
    await this.overrideSwitch.click();
    await this.expectOverridden();
  }

  /** Computed left border of the group (style, width in px, colour). */
  async leftRule(): Promise<{ style: string; width: number; color: string }> {
    return this.group.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { style: cs.borderLeftStyle, width: parseFloat(cs.borderLeftWidth), color: cs.borderLeftColor };
    });
  }
}

export class SettingsTab {
  readonly footer: FormFooter;
  readonly save: Locator;

  constructor(
    readonly page: Page,
    readonly panel: Locator,
  ) {
    this.footer = new FormFooter(page);
    this.save = this.footer.save('Save settings');
  }

  setting(label: string): InheritedSetting {
    return new InheritedSetting(this.page, this.panel, label);
  }

  async saveAndConfirm(): Promise<void> {
    await this.save.click();
    await expect(this.page.getByRole('status').filter({ hasText: exactly('Settings saved') })).toBeVisible();
  }
}

export class EligibilityTab {
  readonly editor: EligibilityEditor;
  readonly note: Locator;
  readonly save: Locator;

  constructor(
    readonly page: Page,
    readonly panel: Locator,
  ) {
    this.editor = new EligibilityEditor(page, panel, 'test');
    this.note = panel.getByText('The series rules apply first. These rules can only narrow them.', { exact: true });
    this.save = button(panel, 'Save eligibility');
  }

  async saveAndConfirm(): Promise<void> {
    await this.save.click();
    await expect(this.page.getByRole('status').filter({ hasText: exactly('Eligibility saved') })).toBeVisible();
  }
}

export class PreviewTab {
  readonly openPreview: Locator;
  readonly checklist: Locator;
  readonly checks: Locator;
  readonly approve: Locator;
  readonly refused: Locator;
  readonly goToQuestions: Locator;

  constructor(
    readonly page: Page,
    readonly panel: Locator,
  ) {
    this.openPreview = panel.getByRole('link', { name: 'Open preview', exact: true });
    this.checklist = panel.getByRole('list', { name: 'Approval checklist', exact: true });
    this.checks = this.checklist.getByRole('listitem');
    this.approve = button(panel, 'Approve test');
    this.refused = page.getByRole('alert').filter({ hasText: exactly(APPROVAL_REFUSED) });
    this.goToQuestions = button(panel, 'Go to questions');
  }

  /** Checklist item n (1 to 4). */
  checkItem(n: 1 | 2 | 3 | 4): Locator {
    return this.checks.nth(n - 1);
  }

  /** Fails unless the checklist shows exactly these four items, in order. */
  async expectChecklist(items: readonly [string, string, string, string]): Promise<void> {
    await expect(this.checks).toHaveCount(4);
    for (const [i, text] of items.entries()) await expect(this.checks.nth(i)).toHaveText(exactly(text));
  }

  async approveAndConfirm(): Promise<void> {
    await this.approve.click();
    await expect(this.page.getByRole('status').filter({ hasText: exactly('Test approved') })).toBeVisible();
  }
}
