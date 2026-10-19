import { describe, expect, it } from 'vitest';
import { importProblems } from './import-checks';
import {
  jsonQuestionsToDrafts,
  sheetPartTexts,
  sheetParts,
  sheetRowCount,
  sheetRowText,
  templateRowsToDrafts,
  textParts,
} from './import-drafts';

const HEADER = ['Question', 'Option A', 'Option B', 'Option C', 'Option D', 'Correct', 'Explanation', 'Difficulty'];

describe('templateRowsToDrafts', () => {
  it('IMP-01 reads each non-empty row of a template sheet as a draft, row numbers as source pages', () => {
    const drafts = templateRowsToDrafts([
      [' question ', 'OPTION A', 'Option B', 'Option C', 'Option D', 'correct', 'Explanation', 'Difficulty', 'Section'],
      ['What is 10% of 90?', '8', '9', '10', '11', 'B', '10 / 100 x 90 = 9.', 'easy', ' Quant '],
      ['', '', '', '', '', '', '', '', ''],
      ['What is 12 x 12?', '124', '144', '154', '164', 'b', '', 'Medium', ''],
    ]);
    expect(drafts).toEqual([
      {
        order: 1,
        sourcePage: 2,
        prompt: 'What is 10% of 90?',
        options: ['8', '9', '10', '11'].map((text, i) => ({ id: 'abcd'[i], text })),
        correctOptionIds: ['b'],
        explanation: '10 / 100 x 90 = 9.',
        difficulty: 'easy',
        difficultySuggested: false,
        sectionName: 'Quant',
        images: [],
      },
      {
        order: 2,
        sourcePage: 4,
        prompt: 'What is 12 x 12?',
        options: ['124', '144', '154', '164'].map((text, i) => ({ id: 'abcd'[i], text })),
        correctOptionIds: ['b'],
        difficulty: 'medium',
        difficultySuggested: false,
        images: [],
      },
    ]);
  });

  it('IMP-09 empty options are dropped, a letter naming one is flagged, several letters fail the single answer', () => {
    const drafts = templateRowsToDrafts([
      HEADER,
      ['Pick one', 'x', '', 'z', '', 'C', '', ''],
      ['Pick one again', 'x', '', 'z', '', 'b', '', ''],
      ['Pick two', 'x', 'y', 'z', '', 'a, B', '', 'unknown'],
      ['No answer', 'x', 'y', '', '', '', '', ''],
    ]) as Exclude<ReturnType<typeof templateRowsToDrafts>, { error: string }>;
    const codes = drafts.map((d) => importProblems(d, { earlierPending: [], testQuestions: [] }).map((p) => p.code));
    expect(drafts[0]?.options).toEqual([
      { id: 'a', text: 'x' },
      { id: 'b', text: 'z' },
    ]);
    expect(drafts[0]?.correctOptionIds).toEqual(['b']);
    expect(codes).toEqual([[], ['NO_CORRECT_ANSWER'], ['MULTIPLE_CORRECT'], ['NO_CORRECT_ANSWER']]);
    expect(drafts[2]?.difficulty).toBeUndefined();
  });

  it('IMP-01 a sheet without Question, Option A, Option B and Correct is not a template', () => {
    expect(
      templateRowsToDrafts([
        ['Q', 'Choices', 'Answer'],
        ['a', 'b', 'c'],
      ]),
    ).toEqual({ error: 'NOT_TEMPLATE' });
    expect(templateRowsToDrafts([])).toEqual({ error: 'NOT_TEMPLATE' });
  });
});

describe('sheet rows and parts', () => {
  it('IMP-02 counts the non-empty rows after the header', () => {
    expect(sheetRowCount([HEADER, ['a'], [' ', ''], ['b']])).toBe(2);
  });

  it('IMP-01 a sheet outside the template goes in CSV parts of 200 rows, each with its header', () => {
    const rows = [['Q', 'Choices'], ...Array.from({ length: 401 }, (_, i) => [`Q${i}, "x"`, 'a; b'])];
    const parts = sheetParts(rows);
    expect(parts).toHaveLength(3);
    expect(parts[0]?.split('\n')[0]).toBe('Q,Choices');
    expect(parts[0]?.split('\n')[1]).toBe('"Q0, ""x""",a; b');
    expect(parts[2]?.trim().split('\n')).toHaveLength(2);
  });

  it('IMP-02 blank rows may be holes, as the worker reads them: counts, parts and row numbers stay the same', () => {
    const rows: string[][] = [];
    rows[0] = HEADER;
    rows[3] = ['What is 2 + 2?', '3', '4', '', '', 'B'];
    expect(sheetRowCount(rows)).toBe(1);
    expect(sheetParts(rows)).toEqual([`${HEADER.join(',')}\nWhat is 2 + 2?,3,4,,,B\n`]);
    expect(templateRowsToDrafts(rows)).toMatchObject([{ order: 1, sourcePage: 4, correctOptionIds: ['b'] }]);
  });
});

describe('sheet text for the review screen', () => {
  it('IMP-11 a row is its cells as <header>: <value> lines, empty cells left out', () => {
    expect(sheetRowText(['Question', 'Option A', '', 'Correct'], ['What is 2 + 2?', '4', 'x', ''])).toBe(
      'Question: What is 2 + 2?\nOption A: 4\nColumn 3: x',
    );
  });

  it('IMP-11 a free sheet part is the text of its rows, a blank line apart, part for part with sheetParts', () => {
    const rows = [
      ['Q', 'Answer'],
      ['Largest planet?', 'Jupiter'],
      [''],
      ['Smallest?', 'Mercury'],
      ['Hottest?', 'Venus'],
    ];
    expect(sheetPartTexts(rows, 2)).toEqual([
      'Q: Largest planet?\nAnswer: Jupiter\n\nQ: Smallest?\nAnswer: Mercury',
      'Q: Hottest?\nAnswer: Venus',
    ]);
    expect(sheetPartTexts(rows, 2)).toHaveLength(sheetParts(rows, 2).length);
  });
});

describe('textParts', () => {
  it('IMP-01 text goes in parts of at most 12,000 characters, split at line breaks', () => {
    const line = `${'x'.repeat(99)}\n`;
    const parts = textParts(line.repeat(250), 'txt');
    expect(parts.map((p) => p.length)).toEqual([12_000, 12_000, 1_000]);
    expect(textParts('short\n', 'txt')).toEqual(['short\n']);
    expect(textParts('', 'md')).toEqual([]);
    expect(textParts('y'.repeat(25_000), 'txt').map((p) => p.length)).toEqual([12_000, 12_000, 1_000]);
  });

  it('IMP-01 Markdown is split before a heading where the part holds one', () => {
    const para = `${'w'.repeat(59)}\n`;
    const text = `# One\n${para.repeat(100)}## Two\n${para.repeat(100)}`;
    const parts = textParts(text, 'md', 8000);
    expect(parts).toHaveLength(2);
    expect(parts[1]?.startsWith('## Two\n')).toBe(true);
  });
});

describe('jsonQuestionsToDrafts', () => {
  it('IMP-01 JSON questions become drafts from page 1 with their given difficulty', () => {
    expect(
      jsonQuestionsToDrafts([
        { prompt: 'What is 25% of 80?', options: ['15', '20'], correct: [1], difficulty: 'easy', tags: [] },
        { prompt: 'Q2', options: ['1', '2'], correct: [], explanation: 'Because.', tags: [] },
      ]),
    ).toEqual([
      {
        order: 1,
        sourcePage: 1,
        prompt: 'What is 25% of 80?',
        options: [
          { id: 'a', text: '15' },
          { id: 'b', text: '20' },
        ],
        correctOptionIds: ['b'],
        difficulty: 'easy',
        difficultySuggested: false,
        images: [],
      },
      {
        order: 2,
        sourcePage: 1,
        prompt: 'Q2',
        options: [
          { id: 'a', text: '1' },
          { id: 'b', text: '2' },
        ],
        correctOptionIds: [],
        explanation: 'Because.',
        difficultySuggested: false,
        images: [],
      },
    ]);
  });
});
