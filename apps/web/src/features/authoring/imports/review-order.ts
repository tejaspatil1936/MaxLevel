import type { ImportDraft, ImportStatus } from '@mitaoe/shared';
import type { MessageKey } from '@/i18n';

// The order of an import's review (IMP-12, IMP-13; docs/testids/phase-6.md, "Review page"): flagged drafts at the
// top, then the valid ones, then those approved and discarded, each group in import order.

export type DraftGroup = 'fix' | 'ready' | 'approved' | 'discarded';
export const DRAFT_GROUPS: readonly DraftGroup[] = ['fix', 'ready', 'approved', 'discarded'];

type Reviewed = Pick<ImportDraft, 'id' | 'order' | 'status' | 'flags'>;

export function draftGroup(d: Reviewed): DraftGroup {
  if (d.status === 'approved') return 'approved';
  if (d.status === 'discarded') return 'discarded';
  return d.flags.length ? 'fix' : 'ready';
}

/** Every draft in display order: group by group, each in `order`. */
export function displayOrder<D extends Reviewed>(drafts: readonly D[]): D[] {
  const rank = (d: D) => DRAFT_GROUPS.indexOf(draftGroup(d));
  return [...drafts].sort((a, b) => rank(a) - rank(b) || a.order - b.order);
}

/** The draft current at first: the first pending one in display order, else the first one. */
export function firstCurrent(drafts: readonly Reviewed[]): string | null {
  const shown = displayOrder(drafts);
  return (shown.find((d) => d.status === 'pending') ?? shown[0])?.id ?? null;
}

/** `J` and `K`: the draft after (or before) the current one in display order; the same one at either end. */
export function stepFrom(drafts: readonly Reviewed[], currentId: string | null, dir: 1 | -1): string | null {
  const shown = displayOrder(drafts);
  const i = shown.findIndex((d) => d.id === currentId);
  if (i < 0) return shown[0]?.id ?? null;
  return shown[Math.min(shown.length - 1, Math.max(0, i + dir))]!.id;
}

/**
 * After approving or discarding a draft: the next pending draft after it in display order (taken before the action),
 * or the previous pending one when there is none after it, or the draft itself when no other is pending.
 */
export function currentAfter(before: readonly Reviewed[], id: string): string {
  const shown = displayOrder(before);
  const i = shown.findIndex((d) => d.id === id);
  const pending = (d: Reviewed) => d.status === 'pending' && d.id !== id;
  const next = shown.slice(i + 1).find(pending) ?? shown.slice(0, Math.max(0, i)).reverse().find(pending);
  return next?.id ?? id;
}

/** The status word of a job (`Ready for review` while a draft is pending, `Reviewed` once none is). */
export function statusWordKey(status: ImportStatus, pendingCount: number): MessageKey {
  if (status === 'ready' && pendingCount === 0) return 'imports.status.reviewed';
  return `imports.status.${status}`;
}

/** The `Import summary` counts. */
export function summaryCounts(drafts: readonly Reviewed[]): Record<DraftGroup | 'found', number> {
  const counts = { found: drafts.length, fix: 0, ready: 0, approved: 0, discarded: 0 };
  for (const d of drafts) counts[draftGroup(d)] += 1;
  return counts;
}
