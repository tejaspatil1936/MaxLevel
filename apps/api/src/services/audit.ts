import { scrubForAudit, type AuditEntry, type Clock } from '@mitaoe/shared';
import type { FastifyRequest } from 'fastify';
import type { Data } from '../data';
import type { Tx } from '../data/audit';

export interface AuditInput {
  action: string;
  target: { type: string; id: string };
  before?: unknown;
  after?: unknown;
}

/**
 * Writes the audit entry for an admin or super-admin action into the same batch as the change (AUD-02), in the
 * organization the request acts in, with the signed-in user as actor (ORG-04, ORG-12).
 */
export function auditWriter(data: Data, clock: Clock) {
  return (req: FastifyRequest, tx: Tx, input: AuditInput, orgId = req.orgId): void => {
    const user = req.user;
    if (!user?.role || !orgId) throw new Error('audit needs a signed-in user and an organization');
    const entry: Omit<AuditEntry, 'id' | 'orgId'> = {
      actor: { uid: user.uid, role: user.role, email: user.email },
      action: input.action,
      target: input.target,
      ...(input.before !== undefined ? { before: scrubForAudit(input.before) } : {}),
      ...(input.after !== undefined ? { after: scrubForAudit(input.after) } : {}),
      ip: req.ip,
      userAgent: String(req.headers['user-agent'] ?? ''),
      requestId: req.id,
      createdAt: clock.now(),
    };
    data.audit.addAudit(orgId, tx, entry);
  };
}
export type AuditWriter = ReturnType<typeof auditWriter>;
