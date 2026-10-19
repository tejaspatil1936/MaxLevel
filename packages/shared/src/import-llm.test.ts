import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { draftsFromModel, LlmAnswerSchema, LlmQuestionSchema, type LlmQuestion } from './import-llm';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../tests/fixtures/llm/${name}`, import.meta.url)), 'utf8');

describe('LlmQuestionSchema', () => {
  it('IMP-05 accepts the recorded answers and drops unknown keys', () => {
    for (const name of ['quant-paper.json', 'reasoning-notes.json', 'free-sheet.json', 'unsafe-markup.json']) {
      const { pages } = JSON.parse(fixture(name)) as { pages: Record<string, unknown[]> };
      for (const questions of Object.values(pages)) expect(LlmAnswerSchema.safeParse({ questions }).success).toBe(true);
    }
    const parsed = LlmQuestionSchema.parse({ prompt: 'Q', options: ['A', 'B'], correct: [0], invented: 'x' });
    expect(parsed).toEqual({ prompt: 'Q', options: ['A', 'B'], correct: [0] });
  });

  it('IMP-05 refuses answers outside the schema', () => {
    const ok = { prompt: 'Q', options: ['A', 'B'], correct: [] };
    expect(LlmQuestionSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, correct: undefined },
      { ...ok, correct: [-1] },
      { ...ok, correct: [0.5] },
      { ...ok, options: ['1', '2', '3', '4', '5', '6', '7'] },
      { ...ok, difficulty: 'trivial' },
      { ...ok, box: { x: 0.1, y: 0.1, w: 1.5, h: 0.2 } },
      { ...ok, figure: { box: { x: 0, y: 0, w: 1, h: 1 } } },
    ]) {
      expect(LlmQuestionSchema.safeParse(bad).success).toBe(false);
    }
    expect(LlmAnswerSchema.safeParse({}).success).toBe(false);
  });
});

describe('draftsFromModel', () => {
  const box = { x: 0.08, y: 0.08, w: 0.84, h: 0.2 };
  const q: LlmQuestion = {
    prompt: '  A train  240 m long passes a pole in 12 seconds.\nWhat is its speed? ',
    options: [' 20 m/s', '24  m/s', '18 m/s ', '22 m/s'],
    correct: [0],
    explanation: 'Speed = 240 / 12 = 20 m/s.',
    difficulty: 'easy',
    section: 'Quantitative aptitude',
    box,
  };

  it('IMP-05 copies prompt and option text unchanged, with option IDs a to f in order', () => {
    const [d] = draftsFromModel(2, [q], 4);
    expect(d!.prompt).toBe(q.prompt);
    expect(d!.options).toEqual([
      { id: 'a', text: ' 20 m/s' },
      { id: 'b', text: '24  m/s' },
      { id: 'c', text: '18 m/s ' },
      { id: 'd', text: '22 m/s' },
    ]);
    expect(d).toMatchObject({ order: 4, sourcePage: 2, sectionName: 'Quantitative aptitude', box, images: [] });
  });

  it('IMP-05 sets correctOptionIds only from correct, never inventing one', () => {
    const [none, two, outside] = draftsFromModel(
      1,
      [
        { ...q, correct: [] },
        { ...q, correct: [2, 0, 2] },
        { ...q, correct: [6] },
      ],
      1,
    );
    expect(none!.correctOptionIds).toEqual([]);
    expect(two!.correctOptionIds).toEqual(['a', 'c']);
    expect(outside!.correctOptionIds).toEqual(['g']);
  });

  it('IMP-05 leaves explanation absent when the model gave none and keeps it as given otherwise', () => {
    const { explanation: _, ...withoutExplanation } = q;
    const [given, absent, blank] = draftsFromModel(1, [q, withoutExplanation, { ...q, explanation: '  ' }], 1);
    expect(given!.explanation).toBe('Speed = 240 / 12 = 20 m/s.');
    expect(absent).not.toHaveProperty('explanation');
    expect(blank).not.toHaveProperty('explanation');
  });

  it('IMP-05 marks the difficulty as a suggestion', () => {
    const { difficulty: _, ...withoutDifficulty } = q;
    const [suggested, absent] = draftsFromModel(1, [q, withoutDifficulty], 1);
    expect(suggested).toMatchObject({ difficulty: 'easy', difficultySuggested: true });
    expect(absent).not.toHaveProperty('difficulty');
    expect(absent!.difficultySuggested).toBe(true);
  });

  it('IMP-05 numbers drafts from startOrder and keeps the figure the model located', () => {
    const figure = { box: { x: 0.2, y: 0.12, w: 0.6, h: 0.12 }, alt: 'Bar chart of yearly sales' };
    const drafts = draftsFromModel(3, [q, { ...q, refersToFigure: true, figure }], 5);
    expect(drafts.map((d) => d.order)).toEqual([5, 6]);
    expect(drafts[1]).toMatchObject({ refersToFigure: true, figure, images: [] });
    expect(drafts[0]).not.toHaveProperty('figure');
    expect(draftsFromModel(1, [], 1)).toEqual([]);
  });

  it("IMP-06 drafts from the injection file's script are exactly its questions, nothing added or marked correct", () => {
    const { pages } = JSON.parse(fixture('reasoning-notes.json')) as { pages: Record<string, LlmQuestion[]> };
    const questions = LlmAnswerSchema.parse({ questions: pages['1'] }).questions;
    const drafts = draftsFromModel(1, questions, 1);
    expect(drafts.map((d) => d.prompt)).toEqual(questions.map((x) => x.prompt));
    expect(drafts.map((d) => d.correctOptionIds)).toEqual(questions.map((x) => x.correct.map((i) => 'abcdef'[i])));
    expect(drafts.filter((d) => d.explanation !== undefined)).toHaveLength(
      questions.filter((x) => x.explanation !== undefined).length,
    );
  });
});
