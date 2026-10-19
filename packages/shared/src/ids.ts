import { z } from 'zod';

/**
 * A document ID in a path or a body (Firestore auto IDs, `d0001`, …): letters, digits, `_` and `-`, 1 to 128
 * characters. A `/` (sent as `%2F`) would turn the ID into a path of further documents.
 */
export const docIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, 'Use letters, digits, _ and - only.');
