import { describe, expect, it } from 'vitest';
import { accommodationExtraSec, accommodationSchema, isAccommodationAmount } from './accommodations';

describe('standing accommodations', () => {
  it('OPS-07 A11Y-17 minutes give that many minutes whatever the duration', () => {
    expect(accommodationExtraSec(60, { extraMin: 15 })).toBe(900);
    expect(accommodationExtraSec(40, { extraMin: 1 })).toBe(60);
  });

  it('OPS-07 A11Y-17 a percentage of the duration is rounded to whole minutes', () => {
    expect(accommodationExtraSec(60, { extraPct: 50 })).toBe(1800);
    expect(accommodationExtraSec(40, { extraPct: 50 })).toBe(1200);
    // 45 × 25% = 11.25 → 11 minutes; 45 × 30% = 13.5 → 14 minutes; 45 × 1% = 0.45 → 0.
    expect(accommodationExtraSec(45, { extraPct: 25 })).toBe(660);
    expect(accommodationExtraSec(45, { extraPct: 30 })).toBe(840);
    expect(accommodationExtraSec(45, { extraPct: 1 })).toBe(0);
    expect(accommodationExtraSec(90, { extraPct: 200 })).toBe(10_800);
  });

  it('OPS-07 A11Y-17 no accommodation gives nothing', () => {
    expect(accommodationExtraSec(60, undefined)).toBe(0);
    expect(accommodationExtraSec(60, {})).toBe(0);
  });

  it('OPS-07 the body is one whole amount in range, never both or neither', () => {
    expect(accommodationSchema.safeParse({ extraPct: 50 }).success).toBe(true);
    expect(accommodationSchema.safeParse({ extraMin: 600 }).success).toBe(true);
    for (const bad of [
      {},
      { extraPct: 0 },
      { extraPct: 201 },
      { extraMin: 601 },
      { extraMin: 1.5 },
      { extraPct: 10, extraMin: 5 },
    ])
      expect(accommodationSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    expect(isAccommodationAmount('pct', 200)).toBe(true);
    expect(isAccommodationAmount('pct', 201)).toBe(false);
    expect(isAccommodationAmount('min', 601)).toBe(false);
    expect(isAccommodationAmount('min', 2.5)).toBe(false);
  });
});
