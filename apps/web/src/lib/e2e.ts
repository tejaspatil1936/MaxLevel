import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { firebaseAuth } from './firebase';

/**
 * Emulator-only sign-in for tests (docs/TEST_ENV.md): an unsigned Google credential that only the Auth emulator
 * accepts. The whole module is dropped from builds made without NEXT_PUBLIC_AUTH_EMULATOR_HOST.
 */
export function installE2eHelpers(onFreshSignIn: () => void): void {
  if (!process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST || typeof window === 'undefined') return;
  (window as unknown as { __e2e: unknown }).__e2e = {
    async signIn(email: string, name?: string) {
      onFreshSignIn();
      const sub = `e2e-${Array.from(email)
        .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
        .toString(16)}`;
      const credential = GoogleAuthProvider.credential(
        JSON.stringify({ sub, email, email_verified: true, name: name ?? email }),
      );
      await signInWithCredential(firebaseAuth(), credential);
    },
  };
}
