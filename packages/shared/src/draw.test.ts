import { describe, expect, it } from 'vitest';
import { drawProblems, drawQuestions, drawSize, seededShuffle, type Difficulty, type DrawPool } from './draw';

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
