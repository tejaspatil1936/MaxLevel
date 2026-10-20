import { z } from 'zod';
import { roleSchema } from './auth';

/** One audit entry (AUD-01). Append-only: no endpoint edits or deletes entries (AUD-04). */
export const auditEntrySchema = z.object({
  id: z.string(),
  orgId: z.string(),
  actor: z.object({ uid: z.string(), role: roleSchema, email: z.string() }),
  action: z.string(),
  target: z.object({ type: z.string(), id: z.string() }),
  before: z.unknown().optional(),
  after: z.unknown().optional(),
  ip: z.string(),
  userAgent: z.string(),
  requestId: z.string(),
  createdAt: z.number(),
});
export type AuditEntry = z.infer<typeof auditEntrySchema>;

/** Fields never copied into before and after values. */
export const AUDIT_SENSITIVE_FIELDS = [
  'correctOptionIds',
  'explanation',
  'token',
  'idToken',
  'password',
  'answers',
] as const;

/** Removes sensitive fields at any depth (AUD-01). */
export function scrubForAudit(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubForAudit);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([k]) => !(AUDIT_SENSITIVE_FIELDS as readonly string[]).includes(k))
        .map(([k, v]) => [k, scrubForAudit(v)]),
    );
  }
  return value;
}
