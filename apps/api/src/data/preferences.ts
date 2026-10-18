import { DEFAULT_PREFERENCES, preferencesSchema, type Preferences } from '@mitaoe/shared';
import type { Firestore } from 'firebase-admin/firestore';

// Per-account preferences live on userIndex/{uid}. Keyed by the signed-in user, not an org (exempt from ORG-03,
// like the other identity records).
export function preferencesData(db: Firestore) {
  return {
    async getPreferences(uid: string): Promise<Preferences> {
      const s = await db.doc(`userIndex/${uid}`).get();
      return preferencesSchema
        .catch(DEFAULT_PREFERENCES)
        .parse({ ...DEFAULT_PREFERENCES, ...(s.get('preferences') ?? {}) });
    },
    async setPreferences(uid: string, prefs: Preferences): Promise<void> {
      await db.doc(`userIndex/${uid}`).set({ preferences: prefs }, { merge: true });
    },
  };
}
