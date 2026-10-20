import type { WhitelistEntry, WhitelistStatus } from '@mitaoe/shared';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { emailKey, normalizeEmail, toMillis } from './keys';
import { writer, type Tx } from './tx';

export function whitelistData(db: Firestore) {
  const col = (orgId: string) => db.collection(`organizations/${orgId}/whitelist`);
  const toEntry = (d: FirebaseFirestore.DocumentSnapshot): WhitelistEntry => ({
    email: d.get('email'),
    prn: d.get('prn') ?? null,
    note: d.get('note') ?? null,
    status: d.get('status'),
    studentId: d.get('studentId') ?? null,
    source: d.get('source') ?? 'upload',
    addedAt: toMillis(d.get('addedAt')),
  });
  return {
    async listWhitelist(orgId: string): Promise<WhitelistEntry[]> {
      return (await col(orgId).get()).docs.map(toEntry);
    },

    async getWhitelistEntry(orgId: string, email: string): Promise<WhitelistEntry | null> {
      const d = await col(orgId).doc(emailKey(email)).get();
      return d.exists ? toEntry(d) : null;
    },

    async getWhitelistEntries(orgId: string, emails: string[]): Promise<Map<string, WhitelistEntry>> {
      const out = new Map<string, WhitelistEntry>();
      for (let i = 0; i < emails.length; i += 300) {
        const refs = emails.slice(i, i + 300).map((e) => col(orgId).doc(emailKey(e)));
        if (!refs.length) continue;
        for (const s of await db.getAll(...refs)) if (s.exists) out.set(s.get('email'), toEntry(s));
      }
      return out;
    },

    async existingEmails(orgId: string): Promise<Set<string>> {
      const snap = await col(orgId).select('email').get();
      return new Set(snap.docs.map((d) => d.get('email') as string));
    },

    async countWhitelist(orgId: string): Promise<number> {
      return (await col(orgId).count().get()).data().count;
    },

    putWhitelistEntry(
      orgId: string,
      tx: Tx,
      entry: {
        email: string;
        prn?: string | null;
        note?: string | null;
        status: WhitelistStatus;
        studentId?: string | null;
        source: WhitelistEntry['source'];
        addedBy: string;
        addedAt: number;
      },
    ): void {
      const email = normalizeEmail(entry.email);
      writer(tx).set(col(orgId).doc(emailKey(email)), {
        orgId,
        email,
        prn: entry.prn ?? null,
        note: entry.note ?? null,
        status: entry.status,
        studentId: entry.studentId ?? null,
        source: entry.source,
        addedBy: entry.addedBy,
        addedAt: entry.addedAt,
      });
      // emailIndex lets bootstrap find every org an email belongs to (spec 10.1).
      writer(tx).set(
        db.doc(`emailIndex/${emailKey(email)}`),
        { orgIds: FieldValue.arrayUnion(orgId) },
        { merge: true },
      );
    },

    updateWhitelistEntry(
      orgId: string,
      tx: Tx,
      email: string,
      patch: Partial<Pick<WhitelistEntry, 'status' | 'studentId' | 'prn' | 'note'>>,
    ): void {
      writer(tx).update(col(orgId).doc(emailKey(email)), { ...patch });
    },

    removeWhitelistEntry(orgId: string, tx: Tx, email: string, stillAdmin: boolean): void {
      writer(tx).delete(col(orgId).doc(emailKey(email)));
      if (!stillAdmin)
        writer(tx).set(
          db.doc(`emailIndex/${emailKey(email)}`),
          { orgIds: FieldValue.arrayRemove(orgId) },
          { merge: true },
        );
    },
  };
}
