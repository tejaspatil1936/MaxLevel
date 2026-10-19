import { importFlags, type ImportDraft, type ImportDraftPatch } from '@mitaoe/shared';
import type { DraftWrite, StoredDraft } from '../data/imports';
import { AppError } from '../errors';

// The question checks on import drafts after the worker (IMP-09, IMP-10; docs/testids/phase-6.md "Question checks on
// drafts"): after any draft edit, approval or discard every pending draft is checked again, in order, against the
// test's questions and the earlier pending drafts, so a duplicate flag follows what is still pending.

type Flags = ImportDraft['flags'];

/** The flags of every pending draft, checked in `order`. */
export function pendingFlags(drafts: readonly StoredDraft[], testQuestions: ReadonlyArray<{ prompt: string }>) {
  const pending = drafts.filter((d) => d.status === 'pending').sort((a, b) => a.order - b.order);
  return new Map<string, Flags>(
    pending.map((d, i) => [d.id, importFlags(d, { earlierPending: pending.slice(0, i), testQuestions })]),
  );
}

const sameFlags = (a: Flags, b: Flags) => JSON.stringify(a) === JSON.stringify(b);

/** The pending drafts whose flags differ from what is stored, with their new flags. */
export function changedFlags(drafts: readonly StoredDraft[], flags: Map<string, Flags>): Array<[string, Flags]> {
  return drafts.flatMap((d) => {
    const next = flags.get(d.id);
    return next && !sameFlags(next, d.flags) ? [[d.id, next] as [string, Flags]] : [];
  });
}

/**
 * What an admin's edit writes on a pending draft (IMP-11). `images` may only keep or drop paths the draft already has,
 * so a draft can never be pointed at another draft's, test's or organization's file (ORG-05). Setting the difficulty
 * makes it the admin's, no longer a suggestion; an empty explanation removes it.
 */
export function draftEdit(draft: StoredDraft, patch: ImportDraftPatch): DraftWrite {
  const write: DraftWrite = {};
  if (patch.images) {
    const own = new Set(draft.images.map((i) => i.path));
    if (patch.images.some((i) => !own.has(i.path)))
      throw new AppError(400, 'VALIDATION', 'An imported question can only keep or remove its own images.', {
        field: 'images',
      });
    write.images = patch.images;
  }
  if (patch.prompt !== undefined) write.prompt = patch.prompt;
  if (patch.options !== undefined) write.options = patch.options;
  if (patch.correctOptionIds !== undefined) write.correctOptionIds = [...new Set(patch.correctOptionIds)];
  if (patch.explanation !== undefined)
    write.explanation = patch.explanation === null || patch.explanation.trim() === '' ? null : patch.explanation;
  if (patch.difficulty !== undefined) {
    write.difficulty = patch.difficulty;
    write.difficultySuggested = false;
  }
  return write;
}

/** The draft with a write applied, `null` removing a field. */
export function applyWrite(draft: StoredDraft, write: DraftWrite): StoredDraft {
  const next: Record<string, unknown> = { ...draft };
  for (const [k, v] of Object.entries(write)) {
    if (v === null) delete next[k];
    else next[k] = v;
  }
  return next as StoredDraft;
}
