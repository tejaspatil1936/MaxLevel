import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

/**
 * Firestore through the Admin SDK with the worker's attached service account, never a key file (SEC-01). On the
 * emulators the SDK reads FIRESTORE_EMULATOR_HOST itself.
 */
export function initFirestore(env: NodeJS.ProcessEnv = process.env): Firestore {
  const projectId = env.GCLOUD_PROJECT ?? env.FIREBASE_PROJECT_ID ?? 'demo-mitaoe';
  return getFirestore(getApps()[0] ?? initializeApp({ projectId }));
}

/** Where export files go: Firebase Storage in every environment (the emulator in tests). */
export interface FileStore {
  save(path: string, body: Buffer, contentType: string): Promise<void>;
}

/**
 * Export files in the project's Storage bucket (EXP-03), which no client can read (DATA-09); the API hands out signed
 * download links. On the emulators the SDK reads FIREBASE_STORAGE_EMULATOR_HOST itself.
 */
export function initFileStore(env: NodeJS.ProcessEnv = process.env): FileStore {
  initFirestore(env);
  const projectId = env.GCLOUD_PROJECT ?? env.FIREBASE_PROJECT_ID ?? 'demo-mitaoe';
  const bucket = getStorage(getApps()[0]).bucket(env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`);
  return {
    async save(path, body, contentType) {
      await bucket.file(path).save(body, { contentType, resumable: false });
    },
  };
}
