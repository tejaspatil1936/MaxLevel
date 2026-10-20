import { serverNow } from '@/lib/api';

/** Graduation years offered in pickers: last year to five years ahead, plus any year already stored. */
export function graduationYears(extra: Array<number | null | undefined> = []): string[] {
  const now = new Date(serverNow()).getFullYear();
  const years = new Set(Array.from({ length: 7 }, (_, i) => now - 1 + i));
  for (const y of extra) if (y) years.add(y);
  return [...years].sort((a, b) => a - b).map(String);
}
