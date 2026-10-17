'use client';

import type { BootstrapResponse, MeResponse } from '@mitaoe/shared';
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signInWithRedirect,
  signOut as fbSignOut,
  type User,
} from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, setWorkspaceOrg } from './api';
import { installE2eHelpers } from './e2e';
import { firebaseAuth } from './firebase';

export type Session =
  | { status: 'loading' }
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
  refresh: () => Promise<void>;
}

const Ctx = createContext<SessionApi | null>(null);

/**
 * Signs the user in with Google (AUTH-01), then bootstraps the session (AUTH-02): the API sets the claims, the client
 * refreshes its ID token, and /v1/me says who the user is. The UI only reflects this; the API enforces everything.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>({ status: 'loading' });
  const forceBootstrap = useRef(false);
  const queryClient = useQueryClient();

  const resolve = useCallback(async (user: User, chosenOrgId?: string) => {
    try {
      const claims = (await user.getIdTokenResult()).claims;
      if (!claims.role || forceBootstrap.current || chosenOrgId) {
        forceBootstrap.current = false;
        const res = await api<BootstrapResponse>('/v1/session/bootstrap', {
          method: 'POST',
          body: chosenOrgId ? { orgId: chosenOrgId } : {},
        });
        if (res.status === 'choose_org') return setSession({ status: 'chooseOrg', orgs: res.orgs });
        await user.getIdToken(true);
      }
      setSession({ status: 'ready', me: await api<MeResponse>('/v1/me') });
    } catch (e) {
      if (
        e instanceof ApiError &&
        (e.code === 'NOT_ON_LIST' || e.code === 'ORG_SUSPENDED' || e.code === 'ACCOUNT_DISABLED')
      ) {
        setSession({ status: 'notOnList', code: e.code });
      } else {
        setSession({ status: 'failed' });
      }
    }
  }, []);

  useEffect(() => installE2eHelpers(() => (forceBootstrap.current = true)), []);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth(), (user) => {
        if (!user) setSession({ status: 'signedOut' });
        else void resolve(user);
      }),
    [resolve],
  );

  const value = useMemo<SessionApi>(
    () => ({
      session,
      async signInWithGoogle() {
        forceBootstrap.current = true;
        const provider = new GoogleAuthProvider();
        try {
          await signInWithPopup(firebaseAuth(), provider);
        } catch (e) {
          // Popups blocked: fall back to a full-page redirect (AUTH-01).
          if ((e as { code?: string }).code === 'auth/popup-blocked')
            await signInWithRedirect(firebaseAuth(), provider);
          else if ((e as { code?: string }).code !== 'auth/popup-closed-by-user') setSession({ status: 'failed' });
        }
      },
      async chooseOrg(orgId) {
        const user = firebaseAuth().currentUser;
        if (user) await resolve(user, orgId);
      },
      async signOut() {
        // Nothing cached for this account may reach the next one on the same browser.
        setWorkspaceOrg(null);
        queryClient.clear();
        await fbSignOut(firebaseAuth());
      },
      async refresh() {
        const user = firebaseAuth().currentUser;
        if (user) await resolve(user);
      },
    }),
    [session, resolve, queryClient],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): SessionApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}
