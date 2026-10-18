import { describe, expect, it } from 'vitest';
import {
  drawAttempt,
  drawProblems,
  drawQuestions,
  drawSize,
  seededShuffle,
  testDrawPools,
  type Difficulty,
  type DrawPool,
} from './draw';

const hundred = Array.from({ length: 100 }, (_, i) => ({ id: `q${i + 1}` }));
const ids = (pool: DrawPool) => new Set(pool.questions.map((q) => q.id));
const withDifficulty = (counts: Record<Difficulty, number>) =>
  (Object.entries(counts) as Array<[Difficulty, number]>).flatMap(([difficulty, n]) =>
    Array.from({ length: n }, (_, i) => ({ id: `${difficulty}${i + 1}`, difficulty })),
  );

describe('drawQuestions', () => {
  it('Q-04 a pool of 100 with drawCount 20 gives 20 distinct IDs from the pool for each seed', () => {
    const pool: DrawPool = { sectionId: null, questions: hundred, drawCount: 20 };
    const draws = ['attempt-1', 'attempt-2', 'attempt-3', 'attempt-4', 'attempt-5'].map(
      (seed) => drawQuestions([pool], seed)[0]!.questionIds,
    );
    for (const draw of draws) {
      expect(draw).toHaveLength(20);
      expect(new Set(draw).size).toBe(20);
      for (const id of draw) expect(ids(pool).has(id)).toBe(true);
    }
    expect(new Set(draws.map((d) => d.join())).size, 'different seeds give different draws').toBeGreaterThan(1);
  });

  it('Q-04 the same seed always gives the same IDs', () => {
    const pool: DrawPool = { sectionId: 'sec-1', questions: hundred, drawCount: 20 };
    expect(drawQuestions([pool], 'attempt-7')).toEqual(drawQuestions([pool], 'attempt-7'));
  });

  it('Q-04 without a draw count every question is returned, in order', () => {
    const pool: DrawPool = { sectionId: null, questions: hundred };
    expect(drawQuestions([pool], 'seed')).toEqual([{ sectionId: null, questionIds: hundred.map((q) => q.id) }]);
    expect(drawSize(pool)).toBe(100);
  });

  it('Q-04 a 2/2/1 difficulty mix gives exactly that many of each difficulty', () => {
    const pool: DrawPool = {
      sectionId: 'quant',
      questions: withDifficulty({ easy: 6, medium: 5, hard: 3 }),
      difficultyMix: { easy: 2, medium: 2, hard: 1 },
    };
    expect(drawSize(pool)).toBe(5);
    for (const seed of ['a', 'b', 'c']) {
      const [drawn] = drawQuestions([pool], seed);
      const byDifficulty = (d: Difficulty) => drawn!.questionIds.filter((id) => id.startsWith(d)).length;
      expect([byDifficulty('easy'), byDifficulty('medium'), byDifficulty('hard')]).toEqual([2, 2, 1]);
      expect(new Set(drawn!.questionIds).size).toBe(5);
    }
  });

  it('Q-04 each pool is drawn on its own, in the order given', () => {
    const pools: DrawPool[] = [
      { sectionId: 'quant', questions: hundred.slice(0, 50), drawCount: 5 },
      { sectionId: 'verbal', questions: hundred.slice(50), drawCount: 3 },
    ];
    const draw = drawQuestions(pools, 'seed');
    expect(draw.map((d) => [d.sectionId, d.questionIds.length])).toEqual([
      ['quant', 5],
      ['verbal', 3],
    ]);
    expect(draw[1]!.questionIds.every((id) => Number(id.slice(1)) > 50)).toBe(true);
  });

  it('Q-04 seededShuffle is a deterministic permutation', () => {
    const items = hundred.map((q) => q.id);
    const once = seededShuffle(items, 'x');
    expect(once).toEqual(seededShuffle(items, 'x'));
    expect([...once].sort()).toEqual([...items].sort());
    expect(once).not.toEqual(items);
  });
});

describe('drawProblems', () => {
  it('Q-04 reports DRAW_TOO_LARGE for a draw above the pool size', () => {
    expect(drawProblems({ sectionId: 's', questions: hundred.slice(0, 4), drawCount: 5 })).toEqual([
      { code: 'DRAW_TOO_LARGE', sectionId: 's', drawCount: 5, available: 4 },
    ]);
  });

  it('Q-04 reports MIX_UNSATISFIABLE for a mix above a difficulty count', () => {
    const pool: DrawPool = {
      sectionId: null,
      questions: withDifficulty({ easy: 3, medium: 2, hard: 0 }),
      difficultyMix: { easy: 2, medium: 2, hard: 1 },
    };
    expect(drawProblems(pool)).toEqual([
      { code: 'MIX_UNSATISFIABLE', sectionId: null, difficulty: 'hard', wanted: 1, available: 0 },
    ]);
  });

  it('Q-04 reports MIX_DRAW_MISMATCH when a set draw differs from the mix total', () => {
    const pool: DrawPool = {
      sectionId: 's',
      questions: withDifficulty({ easy: 3, medium: 3, hard: 3 }),
      difficultyMix: { easy: 1, medium: 1, hard: 1 },
      drawCount: 4,
    };
    expect(drawProblems(pool)).toEqual([{ code: 'MIX_DRAW_MISMATCH', sectionId: 's', mixTotal: 3, drawCount: 4 }]);
  });

  it('Q-04 reports nothing for a satisfiable pool', () => {
    expect(drawProblems({ sectionId: null, questions: hundred, drawCount: 20 })).toEqual([]);
    expect(drawProblems({ sectionId: null, questions: hundred })).toEqual([]);
    expect(
      drawProblems({
        sectionId: 'q',
        questions: withDifficulty({ easy: 2, medium: 2, hard: 1 }),
        difficultyMix: { easy: 2, medium: 2, hard: 1 },
        drawCount: 5,
      }),
    ).toEqual([]);
  });
});

describe('testDrawPools', () => {
  const q = (id: string, sectionId: string | null, difficulty?: Difficulty, status = 'approved') => ({
    id,
    sectionId,
    status,
    ...(difficulty ? { difficulty } : {}),
  });
  const questions = [
    q('a', 's1', 'easy'),
    q('b', 's1', 'hard'),
    q('c', 's2'),
    q('d', 's1', 'easy', 'draft'),
    q('e', null, 'medium'),
    q('f', 'gone'),
  ];

  it('Q-04 US-AD-07 without sections the whole-test pool holds every approved question and the test draw count', () => {
    expect(testDrawPools({ sections: [], drawCount: 3 }, questions)).toEqual([
      {
        sectionId: null,
        questions: [
          { id: 'a', difficulty: 'easy' },
          { id: 'b', difficulty: 'hard' },
          { id: 'c' },
          { id: 'e', difficulty: 'medium' },
          { id: 'f' },
        ],
        drawCount: 3,
      },
    ]);
  });

  it('Q-03 Q-05 with sections each section pools its approved questions with its own draw and mix', () => {
    const mix = { easy: 1, medium: 0, hard: 1 };
    const pools = testDrawPools(
      {
        sections: [
          { id: 's2', drawCount: 1 },
          { id: 's1', difficultyMix: mix },
        ],
        drawCount: 9,
      },
      questions,
    );
    expect(pools).toEqual([
      { sectionId: 's2', questions: [{ id: 'c' }], drawCount: 1 },
      {
        sectionId: 's1',
        questions: [
          { id: 'a', difficulty: 'easy' },
          { id: 'b', difficulty: 'hard' },
        ],
        difficultyMix: mix,
      },
      { sectionId: null, questions: [{ id: 'e', difficulty: 'medium' }, { id: 'f' }] },
    ]);
    expect(pools.flatMap(drawProblems)).toEqual([]);
  });

  it('US-AD-07 a section draw above its approved questions is a problem; no loose pool when every question has a section', () => {
    const pools = testDrawPools({ sections: [{ id: 's1', drawCount: 3 }] }, [
      q('a', 's1'),
      q('b', 's1'),
      q('d', 's1', 'easy', 'draft'),
    ]);
    expect(pools).toHaveLength(1);
    expect(pools.flatMap(drawProblems)).toEqual([
      { code: 'DRAW_TOO_LARGE', sectionId: 's1', drawCount: 3, available: 2 },
    ]);
  });
});

describe('drawAttempt', () => {
  const pools: DrawPool[] = [
    { sectionId: 'quant', questions: hundred.slice(0, 10), drawCount: 4 },
    { sectionId: 'verbal', questions: hundred.slice(10, 20), drawCount: 3 },
  ];
  const options = Object.fromEntries(hundred.slice(0, 20).map((q) => [q.id, ['a', 'b', 'c', 'd']]));
  const off = { shuffleQuestions: false, shuffleOptions: false };
  const on = { shuffleQuestions: true, shuffleOptions: true };

  it('Q-04 US-AD-08 sections stay in order with each draw count, and the same seed gives the same draw', () => {
    const draw = drawAttempt(pools, options, on, 'preview-1');
    expect(draw.sections.map((s) => [s.sectionId, s.questionIds.length])).toEqual([
      ['quant', 4],
      ['verbal', 3],
    ]);
    expect(draw.questionIds).toEqual(draw.sections.flatMap((s) => s.questionIds));
    expect(draw.questionIds.slice(0, 4).every((id) => ids(pools[0]!).has(id))).toBe(true);
    expect(draw.questionIds.slice(4).every((id) => ids(pools[1]!).has(id))).toBe(true);
    expect(drawAttempt(pools, options, on, 'preview-1')).toEqual(draw);
  });

  it('Q-06 with shuffles off the questions keep the pool order and the options their stored order', () => {
    const draw = drawAttempt([{ sectionId: null, questions: hundred.slice(0, 5) }], options, off, 'x');
    expect(draw.questionIds).toEqual(['q1', 'q2', 'q3', 'q4', 'q5']);
    expect(Object.values(draw.optionOrder).every((o) => o.join() === 'a,b,c,d')).toBe(true);
  });

  it("Q-06 US-AD-08 with shuffles on, seeds reorder the questions within a section and each question's options", () => {
    const all = [{ sectionId: null, questions: hundred.slice(0, 8) }];
    const draws = ['s1', 's2', 's3', 's4', 's5'].map((seed) => drawAttempt(all, options, on, seed));
    for (const d of draws) {
      expect([...d.questionIds].sort()).toEqual(
        hundred
          .slice(0, 8)
          .map((q) => q.id)
          .sort(),
      );
      for (const order of Object.values(d.optionOrder)) expect([...order].sort()).toEqual(['a', 'b', 'c', 'd']);
    }
    expect(new Set(draws.map((d) => d.questionIds.join())).size).toBeGreaterThan(1);
    expect(new Set(draws.map((d) => d.optionOrder.q1!.join())).size).toBeGreaterThan(1);
  });
});
