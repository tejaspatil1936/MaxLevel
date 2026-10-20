import type { AuditEntry } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { toOrgRecord, type OrgRecord } from './orgs';

// Super-admin views across organizations. Exempt from the orgId-first rule (ORG-03 allows cross-org lists).

export interface AuditFilter {
  orgId?: string;
  actor?: string;
  action?: string;
  target?: string;
  from?: number;
  to?: number;
}

/** In-memory audit filter shared by the org and platform views (AUD-03). */
export function matchesAudit(e: AuditEntry, f: AuditFilter): boolean {
  if (f.actor && !e.actor.email.includes(f.actor.toLowerCase()) && e.actor.uid !== f.actor) return false;
  if (f.action && !e.action.startsWith(f.action)) return false;
  if (f.target && e.target.id !== f.target && e.target.type !== f.target) return false;
  if (f.from !== undefined && e.createdAt < f.from) return false;
  if (f.to !== undefined && e.createdAt > f.to) return false;
  return true;
}

export function platformData(db: Firestore) {
  return {
    async listOrgs(): Promise<OrgRecord[]> {
      return (await db.collection('organizations').get()).docs
        .map(toOrgRecord)
        .sort((a, b) => a.name.localeCompare(b.name));
    },

    async slugTaken(slug: string): Promise<boolean> {
      return !(await db.collection('organizations').where('slug', '==', slug).limit(1).get()).empty;
    },

    async orgExists(orgId: string): Promise<boolean> {
      return (await db.doc(`organizations/${orgId}`).get()).exists;
    },

    async listAuditAcrossOrgs(f: AuditFilter, max = 2000): Promise<AuditEntry[]> {
      let q: FirebaseFirestore.Query = f.orgId
        ? db.collection(`organizations/${f.orgId}/auditLogs`)
        : db.collectionGroup('auditLogs');
      if (f.from !== undefined) q = q.where('createdAt', '>=', f.from);
      if (f.to !== undefined) q = q.where('createdAt', '<=', f.to);
      const snap = await q.orderBy('createdAt', 'desc').limit(max).get();
      return snap.docs.map((d) => d.data() as AuditEntry).filter((e) => matchesAudit(e, f));
    },
  };
}
