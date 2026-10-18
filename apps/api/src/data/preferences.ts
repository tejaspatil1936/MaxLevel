import { DEFAULT_PREFERENCES, preferencesSchema, type Preferences } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';
import { emailKey } from './keys';

/** Whose preferences: a student's live on their student record; everyone else's on an email-keyed account record. */
export interface PreferencesOwner {
  email: string;
  orgId: string | null;
  studentId: string | null;
}

// Account records are keyed by the signed-in email, not an org (exempt from ORG-03, like the other identity records).
// A student's preferences follow the org-scoped student record, so they are deleted with it.
export function preferencesData(db: Firestore) {
  const ref = (o: PreferencesOwner) =>
    o.orgId && o.studentId
      ? db.doc(`organizations/${o.orgId}/students/${o.studentId}`)
      : db.doc(`accountPreferences/${emailKey(o.email)}`);
  return {
    async getPreferences(owner: PreferencesOwner): Promise<Preferences> {
      const s = await ref(owner).get();
      return preferencesSchema
        .catch(DEFAULT_PREFERENCES)
        .parse({ ...DEFAULT_PREFERENCES, ...(s.get('preferences') ?? {}) });
    },
    async setPreferences(owner: PreferencesOwner, prefs: Preferences): Promise<void> {
      await ref(owner).set({ preferences: prefs }, { merge: true });
    },
  };
}
