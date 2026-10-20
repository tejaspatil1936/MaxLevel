import type { ImportDraft, ImportDraftPatch } from '@mitaoe/shared';
import type { QuestionDraft } from '../questions/question-draft';

// The inline edit of an import draft (IMP-12) uses the question editor's form state and sends only what changed.

/** The draft as the question editor's form state (only the fields a draft has). */
export function formFrom(d: ImportDraft, imageUrls: Record<string, string>): QuestionDraft {
  return {
    prompt: d.prompt,
    options: d.options.map((o) => ({ id: o.id, text: o.text })),
    // Several marked correct (v1 is single answer) starts with none chosen, so saving never picks one silently.
    correct: d.correctOptionIds.length === 1 ? d.correctOptionIds[0]! : '',
    explanation: d.explanation ?? '',
    difficulty: d.difficulty ?? '',
    sectionId: '',
    marks: '',
    negativeMarks: '',
    timeLimit: '',
    tags: '',
    images: d.images.map((img) => ({ ...img, src: imageUrls[img.path] ?? null })),
  };
}

/**
 * Only what the admin changed, so the source's wording (IMP-05) and its answers stay as they were otherwise; empty
 * option rows are dropped. A form saved unchanged sends its prompt, so the checks still run again.
 */
export function patchFrom(before: QuestionDraft, d: QuestionDraft): ImportDraftPatch {
  const patch: ImportDraftPatch = {};
  const options = d.options.filter((o) => o.text.trim() !== '');
  if (d.prompt !== before.prompt) patch.prompt = d.prompt;
  if (JSON.stringify(options) !== JSON.stringify(before.options)) patch.options = options;
  if (d.correct !== before.correct) patch.correctOptionIds = d.correct ? [d.correct] : [];
  if (d.explanation !== before.explanation) patch.explanation = d.explanation.trim() === '' ? null : d.explanation;
  if (d.difficulty !== before.difficulty) patch.difficulty = d.difficulty || null;
  const images = d.images.map(({ path, alt }) => ({ path, alt: alt.trim() }));
  if (JSON.stringify(images) !== JSON.stringify(before.images.map(({ path, alt }) => ({ path, alt }))))
    patch.images = images;
  return Object.keys(patch).length ? patch : { prompt: d.prompt };
}
