import { describe, expect, it } from 'vitest';
import {
  currentAfter,
  displayOrder,
  draftGroup,
  firstCurrent,
  statusWordKey,
  stepFrom,
  summaryCounts,
} from './review-order';

const FLAG = [{ code: 'NO_CORRECT_ANSWER', text: 'No correct answer found in the source.' }];
type Status = 'pending' | 'approved' | 'discarded';
const d = (order: number, status: Status = 'pending', flagged = false) => ({
  id: `d${order}`,
  order,
  status,
  flags: flagged ? FLAG : [],
});
const ids = (list: Array<{ id: string }>) => list.map((x) => x.id);

// The quant-paper import: 2, 3, 4, 6, 7, 8 and 9 flagged, 1 and 5 valid.
const paper = () => [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => d(n, 'pending', ![1, 5].includes(n)));

describe('import review order', () => {
  it('IMP-12 flagged drafts come first, then valid, approved and discarded ones, each in import order', () => {
    const drafts = [d(1, 'approved'), d(2, 'pending', true), d(3, 'discarded'), d(4), d(5, 'pending', true)];
    expect(drafts.map(draftGroup)).toEqual(['approved', 'fix', 'discarded', 'ready', 'fix']);
    expect(ids(displayOrder(drafts))).toEqual(['d2', 'd5', 'd4', 'd1', 'd3']);
    expect(ids(displayOrder(paper()))).toEqual(['d2', 'd3', 'd4', 'd6', 'd7', 'd8', 'd9', 'd1', 'd5']);
  });

  it('IMP-11 the first pending draft in display order is current at first, else the first draft', () => {
    expect(firstCurrent(paper())).toBe('d2');
    expect(firstCurrent([d(1, 'approved'), d(2, 'discarded'), d(3)])).toBe('d3');
    expect(firstCurrent([d(2, 'discarded'), d(1, 'approved')])).toBe('d1');
    expect(firstCurrent([])).toBeNull();
  });

  it('IMP-13 J and K move through every draft in display order and stop at either end', () => {
    const drafts = paper();
    expect(stepFrom(drafts, 'd2', 1)).toBe('d3');
    expect(stepFrom(drafts, 'd9', 1)).toBe('d1');
    expect(stepFrom(drafts, 'd1', -1)).toBe('d9');
    expect(stepFrom(drafts, 'd5', 1)).toBe('d5');
    expect(stepFrom(drafts, 'd2', -1)).toBe('d2');
    expect(stepFrom(drafts, null, 1)).toBe('d2');
  });

  it('IMP-13 after approve or discard the next pending draft becomes current, else the previous pending one', () => {
    const drafts = paper().map((x) => (x.id === 'd4' ? { ...x, flags: [] } : x));
    // Ready to approve: 1, 4, 5.
    expect(currentAfter(drafts, 'd4')).toBe('d5');
    const approved = drafts.map((x) => (x.id === 'd4' ? { ...x, status: 'approved' as const } : x));
    expect(currentAfter(approved, 'd5')).toBe('d1');
    expect(currentAfter(approved, 'd9')).toBe('d1');
    expect(currentAfter([d(1, 'approved'), d(2)], 'd2')).toBe('d2');
  });

  it('IMP-04 IMP-12 the status word says Reviewed once no draft is pending, and the summary counts each group', () => {
    expect(statusWordKey('running', 0)).toBe('imports.status.running');
    expect(statusWordKey('ready', 3)).toBe('imports.status.ready');
    expect(statusWordKey('ready', 0)).toBe('imports.status.reviewed');
    expect(statusWordKey('failed', 0)).toBe('imports.status.failed');
    expect(summaryCounts([...paper().slice(0, 7), d(8, 'approved'), d(9, 'discarded')])).toEqual({
      found: 9,
      fix: 5,
      ready: 2,
      approved: 1,
      discarded: 1,
    });
  });
});
