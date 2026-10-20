import { describe, expect, it } from 'vitest';
import type { StoredDraft } from '../data/imports';
import { applyWrite, changedFlags, draftEdit, pendingFlags } from './import-drafts';

const draft = (order: number, prompt: string, extra: Partial<StoredDraft> = {}): StoredDraft => ({
  id: `d${order}`,
  order,
  sourcePage: 1,
  prompt,
  options: [
    { id: 'a', text: '3' },
    { id: 'b', text: '4' },
  ],
  correctOptionIds: ['b'],
  difficultySuggested: true,
  images: [],
  flags: [],
  status: 'pending',
  ...extra,
});
const DUP = (n: number) => [
  { code: 'DUPLICATE_IN_IMPORT', text: `This looks like a duplicate of imported question ${n}.` },
];

describe('pendingFlags', () => {
  it('IMP-09 checks only pending drafts, each against the earlier pending ones and the test', () => {
    const drafts = [draft(1, 'What is 2 + 2?'), draft(2, 'What is 2 + 2?'), draft(3, 'What is 2 + 2?')];
    expect([...pendingFlags(drafts, []).values()]).toEqual([[], DUP(1), DUP(1)]);
    const discarded = [{ ...drafts[0]!, status: 'discarded' as const }, drafts[1]!, drafts[2]!];
    const flags = pendingFlags(discarded, []);
    expect([...flags.keys()]).toEqual(['d2', 'd3']);
    expect([...flags.values()]).toEqual([[], DUP(2)]);
    expect(pendingFlags([drafts[0]!], [{ prompt: '  what is 2  + 2' }]).get('d1')).toEqual([
      { code: 'DUPLICATE_IN_TEST', text: 'This looks like a duplicate of question 1 in the test.' },
    ]);
  });

  it('IMP-09 changedFlags names only the drafts whose stored flags differ', () => {
    const drafts = [draft(1, 'A'), draft(2, 'A', { flags: DUP(1) }), draft(3, 'B', { flags: DUP(1) })];
    expect(changedFlags(drafts, pendingFlags(drafts, []))).toEqual([['d3', []]]);
  });
});

describe('draftEdit', () => {
  const chart = draft(5, 'The chart shows sales.', {
    images: [{ path: 'organizations/o/imports/j/figures/d0005-1.png', alt: '' }],
  });

  it('IMP-11 writes the given fields; an empty explanation is removed; a set difficulty is no longer suggested', () => {
    expect(
      draftEdit(chart, { prompt: 'Edited', correctOptionIds: ['a', 'a'], explanation: ' ', difficulty: 'hard' }),
    ).toEqual({
      prompt: 'Edited',
      correctOptionIds: ['a'],
      explanation: null,
      difficulty: 'hard',
      difficultySuggested: false,
    });
    const write = draftEdit(chart, { images: [{ path: chart.images[0]!.path, alt: 'Bar chart' }] });
    expect(applyWrite({ ...chart, explanation: 'x' }, { ...write, explanation: null })).toEqual({
      ...chart,
      images: [{ path: chart.images[0]!.path, alt: 'Bar chart' }],
    });
    expect(draftEdit(chart, { images: [] })).toEqual({ images: [] });
  });

  it("ORG-05 refuses an image path the draft does not already have: another draft's, test's or organization's", () => {
    for (const path of [
      'organizations/o/imports/j/figures/d0004-1.png',
      'organizations/o/tests/t/images/x.png',
      'organizations/other/imports/j/figures/d0005-1.png',
    ])
      expect(() => draftEdit(chart, { images: [{ path, alt: 'x' }] }), path).toThrow(
        expect.objectContaining({ statusCode: 400, code: 'VALIDATION' }),
      );
  });
});
