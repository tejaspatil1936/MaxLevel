import { describe, expect, it } from 'vitest';
import {
  discriminationIndex,
  median,
  round2,
  scoreDistribution,
  scoreSummary,
  timeDistribution,
  timeTaken,
} from './report-metrics';

describe('report metrics helpers', () => {
  it('EXP-04 median of odd and even counts, and 0 for none', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it('EXP-04 rounds to 2 decimals without floating-point drift', () => {
    expect(round2(7 / 3)).toBe(2.33);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(58.3333333)).toBe(58.33);
    expect(Object.is(round2(-0.001), 0)).toBe(true);
  });

  it('EXP-04 mean, median, extremes and population standard deviation, rounded', () => {
    expect(scoreSummary([4, 3, 2, 0, 1], 4)).toEqual({
      mean: 2,
      median: 2,
      top: 4,
      bottom: 0,
      stdDev: 1.41,
      meanPct: 50,
    });
    expect(scoreSummary([7, 3, 2], 8)).toEqual({ mean: 4, median: 3, top: 7, bottom: 2, stdDev: 2.16, meanPct: 50 });
    expect(scoreSummary([1, 2], 3)).toMatchObject({ mean: 1.5, median: 1.5, stdDev: 0.5, meanPct: 50 });
    expect(scoreSummary([], 0)).toEqual({ mean: 0, median: 0, top: 0, bottom: 0, stdDev: 0, meanPct: 0 });
  });

  it('EXP-04 distribution bands hold 10k inclusive to 10k + 10 exclusive, the last also 100', () => {
    // 0, 9.99, 10, 99.99 and 100 per cent of 10000.
    const bands = scoreDistribution([0, 999, 1000, 9999, 10000], 10000);
    expect(bands.map((b) => [b.fromPct, b.toPct])).toEqual(Array.from({ length: 10 }, (_, k) => [k * 10, k * 10 + 10]));
    expect(bands.map((b) => b.count)).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 0, 2]);
    // 0.3 of 3 is 10% exactly, never 9.999…; a negative score is in the first band.
    expect(scoreDistribution([0.3, -1], 3).map((b) => b.count)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(scoreDistribution([0, 1, 2, 3, 4], 4).map((b) => b.count)).toEqual([1, 0, 1, 0, 0, 1, 0, 1, 0, 1]);
  });

  it('EXP-04 time taken: mean, median, extremes and 5-minute bands from 0', () => {
    expect(timeTaken([600, 720, 900, 300, 480])).toEqual({
      meanSec: 600,
      medianSec: 600,
      minSec: 300,
      maxSec: 900,
      distribution: [
        { fromMin: 0, toMin: 5, count: 0 },
        { fromMin: 5, toMin: 10, count: 2 },
        { fromMin: 10, toMin: 15, count: 2 },
        { fromMin: 15, toMin: 20, count: 1 },
      ],
    });
    expect(timeDistribution([299, 300])).toEqual([
      { fromMin: 0, toMin: 5, count: 1 },
      { fromMin: 5, toMin: 10, count: 1 },
    ]);
    expect(timeTaken([])).toEqual({ meanSec: 0, medianSec: 0, minSec: 0, maxSec: 0, distribution: [] });
    expect(timeTaken([100, 201]).medianSec).toBe(150.5);
  });

  it('EXP-04 discrimination index: top 27% against bottom 27%, k = ceil(0.27 n), null below 2', () => {
    // `id:score:1` is a correct answer, `id:score:0` a wrong one.
    const di = (...rows: string[]) =>
      discriminationIndex(
        rows.map((r) => {
          const [studentId, score, correct] = r.split(':');
          return { studentId: studentId!, score: Number(score), correct: correct === '1' };
        }),
      );
    expect(di()).toBeNull();
    expect(di('a:1:1')).toBeNull();
    expect(di('a:2:1', 'b:1:0')).toBe(1); // n = 2: k = 1
    // n = 5: k = 2 (scores 4, 3, 2, 0, 1 as in the reported test's question 2).
    expect(di('s1:4:1', 's2:3:1', 's5:2:0', 's6:0:0', 's9:1:1')).toBe(0.5);
    expect(di('a:4:1', 'b:3:0', 'c:2:0', 'd:1:0')).toBe(0.5); // n = 4: k = 2
    // n = 100: k = 27 exactly (not 28 from 0.27 × 100 in floating point).
    const hundred = Array.from(
      { length: 100 },
      (_, i) => `s${String(i).padStart(3, '0')}:${100 - i}:${i < 27 ? 1 : 0}`,
    );
    expect(di(...hundred)).toBe(1);
    // Equal scores are ordered by student ID: `a` is in the top group, `c` in the bottom one.
    expect(di('c:1:0', 'b:1:0', 'a:1:1')).toBe(1);
    expect(di('c:1:1', 'b:1:0', 'a:1:0')).toBe(-1);
  });
});
