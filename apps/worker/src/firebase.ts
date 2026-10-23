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

/** Where export files go and import sources are read from: Firebase Storage in every environment (the emulator in tests). */
export interface FileStore {
  save(path: string, body: Buffer, contentType: string): Promise<void>;
  /** The stored object's bytes, or null when there is none (import sources, IMP-01). */
  read(path: string): Promise<Buffer | null>;
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
    async read(path) {
      const [exists] = await bucket.file(path).exists();
      return exists ? (await bucket.file(path).download())[0] : null;
    },
  };
}

/** What the voice proof cleanup needs of Storage: deleting one object, a missing one counting as deleted. */
export interface ClipStore {
  remove(path: string): Promise<void>;
}

export function initClipStore(env: NodeJS.ProcessEnv = process.env): ClipStore {
  initFirestore(env);
  const projectId = env.GCLOUD_PROJECT ?? env.FIREBASE_PROJECT_ID ?? 'demo-mitaoe';
  const bucket = getStorage(getApps()[0]).bucket(env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`);
  return {
    async remove(path) {
      await bucket.file(path).delete({ ignoreNotFound: true });
    },
  };
}
