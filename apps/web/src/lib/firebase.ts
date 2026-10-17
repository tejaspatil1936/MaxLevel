import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { config } from './config';

let auth: Auth | null = null;

function app(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(config.firebase);
}

/** Firebase Auth for the browser; on the emulator when NEXT_PUBLIC_AUTH_EMULATOR_HOST is set at build time. */
export function firebaseAuth(): Auth {
  if (auth) return auth;
  auth = getAuth(app());
  if (process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST) {
    connectAuthEmulator(auth, `http://${process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST}`, { disableWarnings: true });
  }
  return auth;
}
