'use client';

import type { BootstrapResponse, MeResponse } from '@mitaoe/shared';
import { useQueryClient } from '@tanstack/react-query';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, setWorkspaceOrg } from './api';
import { installE2eHelpers } from './e2e';
import { firebaseAuth } from './firebase';

export type Session =
  | { status: 'loading' }
  | { status: 'signingIn' }
  | { status: 'signedOut' }
  | { status: 'notOnList'; code: string }
  | { status: 'chooseOrg'; orgs: Array<{ orgId: string; name: string }> }
  | { status: 'failed' }
  | { status: 'ready'; me: MeResponse };

interface SessionApi {
  session: Session;
  signInWithGoogle: () => Promise<void>;
  chooseOrg: (orgId: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Tries again after a failure (for example the API was unreachable). */
  retry: () => Promise<void>;
  /** Back to the organization chooser, for an email listed in more than one org (AUTH-04). */
  switchOrg: () => Promise<void>;
  /** Fetches /v1/me again, for example after the profile is completed. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionApi | null>(null);

/**
 * Signs the user in with Google (AUTH-01), then bootstraps the session (AUTH-02): the API sets the claims, the client
 * refreshes its ID token, and /v1/me says who the user is. The UI only reflects this; the API enforces everything.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const queryClient = useQueryClient();
  // The latest resolution wins; an older one that finishes late does not overwrite it.
  const generation = useRef(0);

  const resolve = useCallback(async (user: User, opts: { bootstrap?: boolean; orgId?: string } = {}) => {
    const mine = ++generation.current;
    const set = (s: Session) => {
      if (mine === generation.current) setSession(s);
    };
    try {
      const claims = (await user.getIdTokenResult()).claims;
      if (!claims.role || opts.bootstrap || opts.orgId) {
        const res = await api<BootstrapResponse>('/v1/session/bootstrap', {
          method: 'POST',
          body: opts.orgId ? { orgId: opts.orgId } : {},
        });
        await user.getIdToken(true);
        if (res.status === 'choose_org') return set({ status: 'chooseOrg', orgs: res.orgs });
      }
      set({ status: 'ready', me: await api<MeResponse>('/v1/me') });
    } catch (e) {
      const listed =
        e instanceof ApiError && ['NOT_ON_LIST', 'ORG_SUSPENDED', 'ORG_ARCHIVED', 'ACCOUNT_DISABLED'].includes(e.code);
      set(listed ? { status: 'notOnList', code: (e as ApiError).code } : { status: 'failed' });
    }
  }, []);

  // A fresh sign-in always bootstraps, even when Firebase reports the same user as before (no auth state change).
  const afterSignIn = useCallback((user: User) => resolve(user, { bootstrap: true }), [resolve]);

  useEffect(
    () => installE2eHelpers({ before: () => setSession({ status: 'signingIn' }), after: afterSignIn }),
    [afterSignIn],
  );

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth(), (user) => {
        if (!user) {
          generation.current++;
          setSession({ status: 'signedOut' });
        } else if (generation.current === 0) {
          void resolve(user); // page load with a remembered session
        }
      }),
    [resolve],
  );

  const value = useMemo<SessionApi>(
    () => ({
      session,
      async signInWithGoogle() {
        setSession({ status: 'signingIn' });
        const provider = new GoogleAuthProvider();
        try {
          const cred = await signInWithPopup(firebaseAuth(), provider);
          await afterSignIn(cred.user);
        } catch (e) {
          const code = (e as { code?: string }).code;
          // Popups blocked: fall back to a full-page redirect (AUTH-01).
          if (code === 'auth/popup-blocked') await signInWithRedirect(firebaseAuth(), provider);
          else if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request')
            setSession({ status: 'signedOut' });
          else setSession({ status: 'failed' });
        }
      },
      async chooseOrg(orgId) {
        const user = firebaseAuth().currentUser;
        if (!user) return;
        setSession({ status: 'signingIn' });
        await resolve(user, { orgId });
      },
      async signOut() {
        // Nothing cached for this account may reach the next one on the same browser.
        setWorkspaceOrg(null);
        queryClient.clear();
        await fbSignOut(firebaseAuth());
      },
      async switchOrg() {
        const user = firebaseAuth().currentUser;
        if (!user) return;
        queryClient.clear();
        setSession({ status: 'signingIn' });
        await resolve(user, { bootstrap: true });
      },
      async refresh() {
        const user = firebaseAuth().currentUser;
        if (user) await resolve(user);
      },
      async retry() {
        const user = firebaseAuth().currentUser;
        if (!user) return setSession({ status: 'signedOut' });
        setSession({ status: 'loading' });
        await resolve(user, { bootstrap: true });
      },
    }),
    [session, resolve, afterSignIn, queryClient],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
