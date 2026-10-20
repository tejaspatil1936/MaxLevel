import { getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getDatabase, type Database } from 'firebase-admin/database';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

export interface FirebaseHandles {
  app: App;
  db: Firestore;
  auth: Auth;
  rtdb: Database;
  bucket: ReturnType<ReturnType<typeof getStorage>['bucket']>;
}

export interface FirebaseOptions {
  projectId: string;
  databaseUrl: string;
  storageBucket: string;
}

/** Firebase options from the environment. On the emulators the Admin SDK reads the *_EMULATOR_HOST variables itself. */
export function firebaseOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): FirebaseOptions {
  const projectId = env.GCLOUD_PROJECT ?? env.FIREBASE_PROJECT_ID ?? 'demo-mitaoe';
  const rtdbHost = env.FIREBASE_DATABASE_EMULATOR_HOST;
  return {
    projectId,
    databaseUrl:
      env.FIREBASE_DATABASE_URL ??
      (rtdbHost
        ? `http://${rtdbHost}?ns=${projectId}-default-rtdb`
        : `https://${projectId}-default-rtdb.asia-southeast1.firebasedatabase.app`),
    storageBucket: env.FIREBASE_STORAGE_BUCKET ?? `${projectId}.appspot.com`,
  };
}

/** Initializes the Admin SDK once. Cloud Run uses its attached service account, never a key file (SEC-01). */
export function initFirebase(opts: FirebaseOptions = firebaseOptionsFromEnv()): FirebaseHandles {
  const app =
    getApps()[0] ??
    initializeApp({ projectId: opts.projectId, databaseURL: opts.databaseUrl, storageBucket: opts.storageBucket });
  const db = getFirestore(app);
  return { app, db, auth: getAuth(app), rtdb: getDatabase(app), bucket: getStorage(app).bucket() };
}
