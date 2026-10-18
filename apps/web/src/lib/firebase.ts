import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, inMemoryPersistence, initializeAuth, type Auth } from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase, type Database } from 'firebase/database';
import { config } from './config';

let auth: Auth | null = null;
let database: Database | null = null;
let device: { auth: Auth; database: Database } | null = null;

const DEFAULT_APP = '[DEFAULT]';

function app(): FirebaseApp {
  return getApps().some((a) => a.name === DEFAULT_APP) ? getApp() : initializeApp(config.firebase);
}

function withAuthEmulator(a: Auth): Auth {
  if (process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST) {
    connectAuthEmulator(a, `http://${process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  }
  return a;
}

/** Realtime Database for an app; on the emulator when NEXT_PUBLIC_DATABASE_EMULATOR_HOST is set at build time. */
function databaseOf(of: FirebaseApp): Database {
  const db = getDatabase(of);
  if (process.env.NEXT_PUBLIC_DATABASE_EMULATOR_HOST) {
    const [host, port] = process.env.NEXT_PUBLIC_DATABASE_EMULATOR_HOST.split(':');
    connectDatabaseEmulator(db, host!, Number(port));
  }
  return db;
}

/** Firebase Auth for the browser; on the emulator when NEXT_PUBLIC_AUTH_EMULATOR_HOST is set at build time. */
export function firebaseAuth(): Auth {
  if (auth) return auth;
  auth = withAuthEmulator(getAuth(app()));
  return auth;
}

/**
 * Realtime Database as the signed-in account (spec 10.2): presence writes and live reads, guarded by
 * database.rules.json (DATA-10). The web app never talks to Firestore or Storage directly.
 */
export function firebaseDatabase(): Database {
  if (database) return database;
  firebaseAuth();
  database = databaseOf(app());
  return database;
}

/**
 * The paired phone's own Firebase app (PR-14): its device sign-in is kept in memory only and apart from the account
 * session, so it never reaches the API session or another tab.
 */
export function deviceFirebase(): { auth: Auth; database: Database } {
  if (device) return device;
  const of = getApps().find((a) => a.name === 'device') ?? initializeApp(config.firebase, 'device');
  device = {
    auth: withAuthEmulator(initializeAuth(of, { persistence: inMemoryPersistence })),
    database: databaseOf(of),
  };
  return device;
}
