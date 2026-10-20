import { createHash } from 'node:crypto';
import type { Auth } from 'firebase-admin/auth';

// The Auth emulator signs nothing: its ID tokens are unsigned JWTs for the default project. Integration tests run in
// their own emulator project, so they build the same unsigned token for that project. The Admin SDK verifies it
// against the emulator exactly as it verifies a real one (claims, expiry, and revocation through getUser).

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const project = () => process.env.GCLOUD_PROJECT ?? 'demo-mitaoe';
export const uidFor = (email: string) => `g-${createHash('sha1').update(email).digest('hex').slice(0, 16)}`;

/** An ID token for the user as it stands now, including their current custom claims (like a token refresh). */
export async function idTokenFor(
  auth: Auth,
  uid: string,
  opts: { authTimeSec?: number; emailVerified?: boolean; provider?: string } = {},
): Promise<string> {
  const user = await auth.getUser(uid);
  // Real clock on purpose: the Admin SDK checks expiry against the machine's time, not the test clock.
  const now = Math.floor(Date.now() / 1000);
  const p = project();
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
    iss: `https://securetoken.google.com/${p}`,
    aud: p,
    auth_time: opts.authTimeSec ?? now - 5,
    user_id: uid,
    sub: uid,
    iat: now - 5,
    exp: now + 3600,
    email: user.email,
    email_verified: opts.emailVerified ?? true,
    firebase: { identities: { email: [user.email] }, sign_in_provider: opts.provider ?? 'google.com' },
    ...user.customClaims,
  })}.`;
}

/** Signs a Google account in (creating it on first use) and returns a fresh ID token. */
export async function signIn(auth: Auth, email: string): Promise<{ uid: string; token: () => Promise<string> }> {
  const uid = uidFor(email);
  await auth.getUser(uid).catch(() => auth.createUser({ uid, email, emailVerified: true }));
  return { uid, token: () => idTokenFor(auth, uid) };
}

/** Records a token revocation at `validSinceSec`, as revokeRefreshTokens does, so tests can place it after a token. */
export async function revokeAfter(uid: string, validSinceSec: number): Promise<void> {
  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const res = await fetch(`http://${host}/identitytoolkit.googleapis.com/v1/projects/${project()}/accounts:update`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ localId: uid, validSince: String(validSinceSec) }),
  });
  if (!res.ok) throw new Error(`revoke failed: ${res.status} ${await res.text()}`);
}

/** Signs an account in with the given claims and returns a bearer header for it. */
export async function asClaims(
  auth: Auth,
  email: string,
  claims: Record<string, string>,
): Promise<{ authorization: string }> {
  const user = await signIn(auth, email);
  await auth.setCustomUserClaims(user.uid, claims);
  return { authorization: `Bearer ${await user.token()}` };
}
