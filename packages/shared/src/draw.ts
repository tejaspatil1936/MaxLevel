// Question pools and the draw (spec 6.5, Q-04, Q-05, Q-06). Deterministic: the same seed always gives the same draw.

export type Difficulty = 'easy' | 'medium' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

export interface DrawPool {
  /** null = the whole-test pool. */
  sectionId: string | null;
  /** Approved questions only, in order. */
  questions: ReadonlyArray<{ id: string; difficulty?: Difficulty }>;
  drawCount?: number;
  difficultyMix?: { easy: number; medium: number; hard: number };
}

export type DrawProblem =
  | { code: 'DRAW_TOO_LARGE'; sectionId: string | null; drawCount: number; available: number }
  | { code: 'MIX_UNSATISFIABLE'; sectionId: string | null; difficulty: Difficulty; wanted: number; available: number }
  | { code: 'MIX_DRAW_MISMATCH'; sectionId: string | null; mixTotal: number; drawCount: number };

const mixTotal = (mix: DrawPool['difficultyMix']) => (mix ? mix.easy + mix.medium + mix.hard : 0);

/** A mix whose counts are all 0 is no mix. */
const activeMix = (pool: DrawPool) => (mixTotal(pool.difficultyMix) > 0 ? pool.difficultyMix : undefined);

/** How many questions a student gets from the pool: the mix total, else the draw count, else all questions. */
export function drawSize(pool: DrawPool): number {
  const mix = activeMix(pool);
  if (mix) return mixTotal(mix);
  return pool.drawCount ?? pool.questions.length;
}

const countOf = (pool: DrawPool, d: Difficulty) => pool.questions.filter((q) => q.difficulty === d).length;

/** Why the pool cannot be drawn as configured; empty when it can (Q-05). */
export function drawProblems(pool: DrawPool): DrawProblem[] {
  const problems: DrawProblem[] = [];
  const { sectionId, drawCount } = pool;
  if (drawCount !== undefined && drawCount > pool.questions.length) {
    problems.push({ code: 'DRAW_TOO_LARGE', sectionId, drawCount, available: pool.questions.length });
  }
  const mix = activeMix(pool);
  if (mix) {
    for (const difficulty of DIFFICULTIES) {
      const available = countOf(pool, difficulty);
      if (mix[difficulty] > available) {
        problems.push({ code: 'MIX_UNSATISFIABLE', sectionId, difficulty, wanted: mix[difficulty], available });
      }
    }
    if (drawCount !== undefined && drawCount !== mixTotal(mix)) {
      problems.push({ code: 'MIX_DRAW_MISMATCH', sectionId, mixTotal: mixTotal(mix), drawCount });
    }
  }
  return problems;
}

/** 32-bit hash of a string (xmur3), used to seed the generator. */
function hashSeed(seed: string): number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Small seeded PRNG (mulberry32): a function returning floats in [0, 1). */
export function seededRandom(seed: string): () => number {
  let a = hashSeed(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shuffled copy (Fisher-Yates), the same for the same seed. Used for shuffle questions and shuffle options. */
export function seededShuffle<T>(items: ReadonlyArray<T>, seed: string): T[] {
  const out = [...items];
  const random = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** `count` items picked at random, kept in their original order. */
function pick<T>(items: ReadonlyArray<T>, count: number, seed: string): T[] {
  if (count >= items.length) return [...items];
  const chosen = new Set(
    seededShuffle(
      items.map((_, i) => i),
      seed,
    ).slice(0, Math.max(0, count)),
  );
  return items.filter((_, i) => chosen.has(i));
}

/**
 * The draw for one attempt (Q-04, Q-06): per pool, the mix counts per difficulty, else `drawCount` questions, else
 * all of them. Picked questions keep the pool order (shuffling is the separate shuffle setting). An unsatisfiable
 * pool gives as many as it has; drawProblems blocks that configuration before a test is approved.
 */
export function drawQuestions(
  pools: ReadonlyArray<DrawPool>,
  seed: string,
): Array<{ sectionId: string | null; questionIds: string[] }> {
  return pools.map((pool) => {
    const poolSeed = `${seed}:${pool.sectionId ?? ''}`;
    const mix = activeMix(pool);
    let picked: ReadonlyArray<{ id: string }>;
    if (mix) {
      const ids = new Set(
        DIFFICULTIES.flatMap((d) =>
          pick(
            pool.questions.filter((q) => q.difficulty === d),
            mix[d],
            `${poolSeed}:${d}`,
          ).map((q) => q.id),
        ),
      );
      picked = pool.questions.filter((q) => ids.has(q.id));
    } else {
      picked = pick(pool.questions, drawSize(pool), poolSeed);
    }
    return { sectionId: pool.sectionId, questionIds: picked.map((q) => q.id) };
  });
}

/** What testDrawPools reads from a test: its sections (in order) and its whole-test draw count. */
export interface PoolConfig {
  sections: ReadonlyArray<{
    id: string;
    drawCount?: number;
    difficultyMix?: { easy: number; medium: number; hard: number };
  }>;
  drawCount?: number;
}

/**
 * A test's pools (Q-03, Q-04): without sections, one whole-test pool of every approved question with the test's draw
 * count; with sections, one pool per section of its approved questions, in section order, then a pool of approved
 * questions in no section (only when there are some), drawn in full because the whole-test draw applies only to a
 * test without sections.
 */
export function testDrawPools(
  test: PoolConfig,
  questions: ReadonlyArray<{ id: string; status: string; sectionId?: string | null; difficulty?: Difficulty }>,
): DrawPool[] {
  const approved = questions
    .filter((q) => q.status === 'approved')
    .map((q) => ({ id: q.id, sectionId: q.sectionId ?? null, ...(q.difficulty ? { difficulty: q.difficulty } : {}) }));
  const strip = (qs: typeof approved) => qs.map(({ sectionId: _s, ...q }) => q);
  if (test.sections.length === 0) {
    const drawCount = test.drawCount !== undefined ? { drawCount: test.drawCount } : {};
    return [{ sectionId: null, questions: strip(approved), ...drawCount }];
  }
  const ids = new Set(test.sections.map((s) => s.id));
  const pools: DrawPool[] = test.sections.map((s) => ({
    sectionId: s.id,
    questions: strip(approved.filter((q) => q.sectionId === s.id)),
    ...(s.drawCount !== undefined ? { drawCount: s.drawCount } : {}),
    ...(s.difficultyMix ? { difficultyMix: s.difficultyMix } : {}),
  }));
  const loose = approved.filter((q) => q.sectionId === null || !ids.has(q.sectionId));
  return loose.length ? [...pools, { sectionId: null, questions: strip(loose) }] : pools;
}

/** The draw stored on an attempt (PLAN Attempt.draw): questions in exam order, each one's option order, per pool. */
export interface AttemptDraw {
  questionIds: string[];
  optionOrder: Record<string, string[]>;
  sections: Array<{ sectionId: string | null; questionIds: string[] }>;
}

/**
 * One attempt's draw (Q-04, Q-06, spec 5.4): the pools drawn in order, then with shuffle questions on the questions of
 * each pool shuffled (sections keep their order), and with shuffle options on each question's options shuffled. The
 * same seed always gives the same draw; the exam preview passes a fresh seed each time it opens (Q-13).
 */
export function drawAttempt(
  pools: ReadonlyArray<DrawPool>,
  options: Readonly<Record<string, ReadonlyArray<string>>>,
  shuffle: { shuffleQuestions: boolean; shuffleOptions: boolean },
  seed: string,
): AttemptDraw {
  const sections = drawQuestions(pools, seed).map((s) => ({
    sectionId: s.sectionId,
    questionIds: shuffle.shuffleQuestions
      ? seededShuffle(s.questionIds, `${seed}:order:${s.sectionId ?? ''}`)
      : s.questionIds,
  }));
  const questionIds = sections.flatMap((s) => s.questionIds);
  const optionOrder = Object.fromEntries(
    questionIds.map((id) => {
      const ids = options[id] ?? [];
      return [id, shuffle.shuffleOptions ? seededShuffle(ids, `${seed}:options:${id}`) : [...ids]];
    }),
  );
  return { questionIds, optionOrder, sections };
}
