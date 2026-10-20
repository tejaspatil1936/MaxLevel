import { z } from 'zod';

/**
 * A document ID in a path or a body (Firestore auto IDs, `d0001`, …): letters, digits, `_` and `-`, 1 to 128
 * characters. A `/` (sent as `%2F`) would turn the ID into a path of further documents, `.` and `..` are refused by
 * Firestore, and so are names that start and end with `__` (reserved). Use it for every request ID that ends up in a
 * Firestore path, so a bad one is a 400 and never reaches Firestore.
 */
export const docIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,128}$/, 'Use letters, digits, _ and - only.')
  .refine((id) => !(id.startsWith('__') && id.endsWith('__')), 'This ID is reserved.');
