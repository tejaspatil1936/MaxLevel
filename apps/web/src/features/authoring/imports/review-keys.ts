import type { ImportDraft } from '@mitaoe/shared';
import type { KeyboardEvent } from 'react';
import type { MessageKey } from '@/i18n';
import { stepFrom } from './review-order';
import type { DraftReview } from './useDraftReview';

/** The review keys, listed under `Review shortcuts` in the `?` dialog (IMP-13). */
export const REVIEW_KEYS: ReadonlyArray<{ keys: string; label: MessageKey }> = [
  { keys: 'J', label: 'imports.key.next' },
  { keys: 'K', label: 'imports.key.previous' },
  { keys: 'A', label: 'imports.key.approve' },
  { keys: 'E', label: 'imports.key.edit' },
  { keys: 'D', label: 'imports.key.discard' },
];

/** A key pressed in a field, a select or an open edit form types there and never acts (WCAG 2.1.4). */
const inField = (target: EventTarget) => {
  const el = target as Partial<Element>;
  return typeof el.closest === 'function' && !!el.closest('input, textarea, select, form, [contenteditable="true"]');
};

/**
 * IMP-13: J, K, A, E and D act on the current draft, only while focus is inside the draft groups (on an article or
 * one of its buttons). Elsewhere on the page they do nothing, so they cannot fire by accident. In an archived
 * organization (read-only, ORG-07) only J and K act.
 */
export function reviewKeyHandler(drafts: readonly ImportDraft[], review: DraftReview) {
  return (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || inField(e.target)) return;
    const d = drafts.find((x) => x.id === review.current);
    const key = e.key.toLowerCase();
    if (key === 'j' || key === 'k') review.goTo(stepFrom(drafts, review.current, key === 'j' ? 1 : -1));
    else if (!d || review.readOnly) return;
    else if (key === 'a') review.approveOne(d);
    else if (key === 'e') review.startEdit(d);
    else if (key === 'd') review.discardOne(d);
    else return;
    e.preventDefault();
  };
}
