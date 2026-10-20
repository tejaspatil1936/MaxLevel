import { z } from 'zod';

/** Accessibility and display preferences, saved on the account (A11Y-01, A11Y-02). */
export const preferencesSchema = z.object({
  textSize: z.union([z.literal(100), z.literal(115), z.literal(130), z.literal(150)]),
  theme: z.enum(['light', 'dark', 'system']),
  highContrast: z.boolean(),
  reduceMotion: z.enum(['on', 'off', 'system']),
  increasedSpacing: z.boolean(),
  readingRuler: z.boolean(),
});
export type Preferences = z.infer<typeof preferencesSchema>;

export const DEFAULT_PREFERENCES: Preferences = {
  textSize: 100,
  theme: 'system',
  highContrast: false,
  reduceMotion: 'system',
  increasedSpacing: false,
  readingRuler: false,
};
