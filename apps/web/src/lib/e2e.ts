import { GoogleAuthProvider, signInWithCredential, type User } from 'firebase/auth';
import { firebaseAuth } from './firebase';

/**
 * Emulator-only sign-in for tests (docs/TEST_ENV.md): an unsigned Google credential that only the Auth emulator
 * accepts. Builds without NEXT_PUBLIC_AUTH_EMULATOR_HOST inline it as empty, so this code is removed.
 */
export function installE2eHelpers(hooks: { before: () => void; after: (user: User) => Promise<void> }): void {
  if (!process.env.NEXT_PUBLIC_AUTH_EMULATOR_HOST || typeof window === 'undefined') return;
  (window as unknown as { __e2e: unknown }).__e2e = {
    async signIn(email: string, name?: string) {
      hooks.before();
      const sub = `e2e-${Array.from(email)
        .reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7)
        .toString(16)}`;
      const credential = GoogleAuthProvider.credential(
        JSON.stringify({ sub, email, email_verified: true, name: name ?? email }),
      );
      const { user } = await signInWithCredential(firebaseAuth(), credential);
      await hooks.after(user);
    },
  };
}
