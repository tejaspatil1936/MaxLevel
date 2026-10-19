import type { ImportDraft } from '@mitaoe/shared';
import type { KeyboardEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { REVIEW_KEYS, reviewKeyHandler } from './review-keys';
import type { DraftReview } from './useDraftReview';

const draft = (order: number): ImportDraft => ({
  id: `d${order}`,
  order,
  sourcePage: 1,
  prompt: `Question ${order}`,
  options: [],
  correctOptionIds: [],
  difficultySuggested: false,
  images: [],
  flags: [],
  status: 'pending',
});
const drafts = [draft(1), draft(2), draft(3)];

function setup() {
  const review = {
    current: 'd2',
    goTo: vi.fn(),
    approveOne: vi.fn(),
    startEdit: vi.fn(),
    discardOne: vi.fn(),
  } as unknown as DraftReview;
  const handle = reviewKeyHandler(drafts, review);
  const press = (key: string, target: EventTarget = { closest: () => null } as unknown as Element, mods = {}) => {
    const e = { key, target, defaultPrevented: false, preventDefault: vi.fn(), ...mods };
    handle(e as unknown as KeyboardEvent);
    return e.preventDefault;
  };
  return { review, press };
}

describe('import review keys', () => {
  it('IMP-13 J and K move to the next and previous draft; A, E and D act on the current one', () => {
    const { review, press } = setup();
    expect(press('j')).toHaveBeenCalled();
    expect(review.goTo).toHaveBeenLastCalledWith('d3');
    press('K');
    expect(review.goTo).toHaveBeenLastCalledWith('d1');
    press('a');
    press('e');
    press('d');
    expect(review.approveOne).toHaveBeenCalledWith(drafts[1]);
    expect(review.startEdit).toHaveBeenCalledWith(drafts[1]);
    expect(review.discardOne).toHaveBeenCalledWith(drafts[1]);
    expect(REVIEW_KEYS.map((k) => k.keys)).toEqual(['J', 'K', 'A', 'E', 'D']);
  });

  it('IMP-13 WCAG 2.1.4 keys typed in a field or form, or with a modifier, or other keys, do nothing', () => {
    const { review, press } = setup();
    const field = { closest: (s: string) => (s.includes('textarea') ? {} : null) } as unknown as Element;
    expect(press('a', field)).not.toHaveBeenCalled();
    press('d', undefined, { ctrlKey: true });
    expect(press('x')).not.toHaveBeenCalled();
    expect(review.approveOne).not.toHaveBeenCalled();
    expect(review.discardOne).not.toHaveBeenCalled();
  });
});
