import { createHash } from 'node:crypto';

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
/** Document key for emailIndex/ and whitelist/ (spec 10.1): sha256 of the normalized email. */
export const emailKey = (email: string) => createHash('sha256').update(normalizeEmail(email)).digest('hex');
