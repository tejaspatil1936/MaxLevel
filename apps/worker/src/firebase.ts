import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Firestore through the Admin SDK with the worker's attached service account, never a key file (SEC-01). On the
 * emulators the SDK reads FIRESTORE_EMULATOR_HOST itself.
 */
export function initFirestore(env: NodeJS.ProcessEnv = process.env): Firestore {
  const projectId = env.GCLOUD_PROJECT ?? env.FIREBASE_PROJECT_ID ?? 'demo-mitaoe';
  return getFirestore(getApps()[0] ?? initializeApp({ projectId }));
}
