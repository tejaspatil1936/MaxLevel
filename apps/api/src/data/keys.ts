import { createHash } from 'node:crypto';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
/** Document key for emailIndex/ and whitelist/ (spec 10.1): sha256 of the normalized email. */
export const emailKey = (email: string) => createHash('sha256').update(normalizeEmail(email)).digest('hex');

/** Safely normalizes timestamps from number, ISO string, or Firestore Timestamp to number milliseconds. */
export const toMillis = (val: unknown): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') return Date.parse(val) || 0;
  if (val && typeof (val as { toMillis?: () => number }).toMillis === 'function') {
    return (val as { toMillis: () => number }).toMillis();
  }
  return 0;
};
