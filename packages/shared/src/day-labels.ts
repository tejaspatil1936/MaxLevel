// Day labels (TST-02): suggested from schedule order, renamable and hideable.

export interface DayLabelTest {
  id: string;
  /** yyyy-mm-dd */
  scheduledDate: string;
  dayNumber?: string | null;
  dayHidden?: boolean;
}

/**
 * Label per test ID. A test without a day number is `Day <n>`, n being its position in scheduled-date order
 * (input order breaks ties), counting every test, renamed and hidden ones too, so a rename or a hidden label never
 * renumbers the others. A stored `dayNumber` is shown instead; a hidden label is `null`.
 */
export function dayLabels(tests: ReadonlyArray<DayLabelTest>): Record<string, string | null> {
  const ordered = tests
    .map((t, i) => ({ t, i }))
    .sort((a, b) =>
      a.t.scheduledDate < b.t.scheduledDate ? -1 : a.t.scheduledDate > b.t.scheduledDate ? 1 : a.i - b.i,
    );
  const labels: Record<string, string | null> = {};
  ordered.forEach(({ t }, position) => {
    const custom = t.dayNumber?.trim();
    labels[t.id] = t.dayHidden ? null : custom ? custom : `Day ${position + 1}`;
  });
  return labels;
}
