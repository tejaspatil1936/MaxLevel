import type { ImportDraft } from '@mitaoe/shared';
import { describe, expect, it } from 'vitest';
import { formFrom, patchFrom } from './draft-form';

const FIG = 'organizations/o/imports/j/figures/d0004-1.png';
const draft: ImportDraft = {
  id: 'd0004',
  order: 4,
  sourcePage: 2,
  prompt: 'Pipe A fills a tank in 6 hours  and pipe B in 3. How long together?',
  options: [
    { id: 'a', text: '1 hour' },
    { id: 'b', text: '2 hours' },
  ],
  correctOptionIds: [],
  difficulty: 'medium',
  difficultySuggested: true,
  images: [{ path: FIG, alt: '' }],
  flags: [{ code: 'NO_CORRECT_ANSWER', text: 'No correct answer found in the source.' }],
  status: 'pending',
};

describe('import draft inline edit', () => {
  it('IMP-12 the form starts from the draft, with no answer chosen when the source marks none or several', () => {
    const form = formFrom(draft, { [FIG]: 'data:image/png;base64,AA==' });
    expect(form).toMatchObject({ prompt: draft.prompt, correct: '', explanation: '', difficulty: 'medium' });
    expect(form.images).toEqual([{ path: FIG, alt: '', src: 'data:image/png;base64,AA==' }]);
    expect(formFrom({ ...draft, correctOptionIds: ['a', 'b'] }, {}).correct).toBe('');
    expect(formFrom({ ...draft, correctOptionIds: ['b'] }, {}).correct).toBe('b');
  });

  it('IMP-05 IMP-12 only the changed fields are sent, the wording untouched; an unchanged form sends its prompt', () => {
    const before = formFrom(draft, {});
    expect(patchFrom(before, { ...before, correct: 'b' })).toEqual({ correctOptionIds: ['b'] });
    expect(patchFrom(before, before)).toEqual({ prompt: draft.prompt });
    expect(
      patchFrom(before, {
        ...before,
        options: [...before.options, { id: 'c', text: '' }],
        images: [{ path: FIG, alt: ' Two pipes ', src: null }],
        explanation: '  ',
        difficulty: '',
      }),
    ).toEqual({ images: [{ path: FIG, alt: 'Two pipes' }], explanation: null, difficulty: null });
    expect(patchFrom(before, { ...before, options: [{ id: 'a', text: '1 hour' }], images: [] })).toEqual({
      options: [{ id: 'a', text: '1 hour' }],
      images: [],
    });
  });
});
