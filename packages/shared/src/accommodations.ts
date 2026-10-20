import { z } from 'zod';

// Standing accommodations (OPS-07, A11Y-17; docs/testids/phase-5.md "Standing accommodations"): a student's extra time
// on every test of a series, as a percentage of the test's duration or whole minutes. It is stored on the student
// record as `accommodations: { [seriesId]: { extraPct } | { extraMin } }` and applied once, when an attempt starts.

/** The largest percentage of a test's duration. */
export const MAX_ACCOMMODATION_PCT = 200;
/** The largest number of extra minutes. */
export const MAX_ACCOMMODATION_MIN = 600;

export interface Accommodation {
  extraPct?: number;
  extraMin?: number;
}

/**
 * The extra seconds an accommodation gives an attempt of a test lasting `durationMin` (the resolved duration; in a
 * fixed slot, the slot length): `extraMin × 60`, or `round(durationMin × extraPct / 100)` whole minutes × 60, or 0.
 */
export function accommodationExtraSec(durationMin: number, a: Accommodation | undefined): number {
  if (a?.extraMin !== undefined) return a.extraMin * 60;
  if (a?.extraPct !== undefined) return Math.round((durationMin * a.extraPct) / 100) * 60;
  return 0;
}

/** Whether a typed amount fits the kind: a whole percentage from 1 to 200, or whole minutes from 1 to 600. */
export const isAccommodationAmount = (kind: 'pct' | 'min', amount: number) =>
  Number.isInteger(amount) && amount >= 1 && amount <= (kind === 'pct' ? MAX_ACCOMMODATION_PCT : MAX_ACCOMMODATION_MIN);

/** PUT /v1/students/{id}/accommodations/{seriesId}: exactly one of `extraPct` and `extraMin`. */
export const accommodationSchema = z.union([
  z.object({ extraPct: z.number().int().min(1).max(MAX_ACCOMMODATION_PCT) }).strict(),
  z.object({ extraMin: z.number().int().min(1).max(MAX_ACCOMMODATION_MIN) }).strict(),
]);
export type AccommodationInput = z.infer<typeof accommodationSchema>;

/** A student's accommodations by series ID. */
export const accommodationsSchema = z.record(z.string(), accommodationSchema);
export type Accommodations = z.infer<typeof accommodationsSchema>;
