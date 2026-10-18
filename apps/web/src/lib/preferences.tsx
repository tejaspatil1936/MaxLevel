'use client';

import { DEFAULT_PREFERENCES, preferencesSchema, type Preferences } from '@mitaoe/shared';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { api } from './api';
import { applyPreferences, PREFERENCES_KEY as KEY } from './preferences-boot';
import { useSession } from './session';

const subscribe = (onChange: () => void) => {
  window.addEventListener('storage', onChange);
  return () => window.removeEventListener('storage', onChange);
};
const readCache = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

function parse(raw: string | null): Preferences | null {
  try {
    return raw ? preferencesSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

interface PreferencesApi {
  preferences: Preferences;
  update: (patch: Partial<Preferences>) => void;
}
const Ctx = createContext<PreferencesApi | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const { session } = useSession();
  // This browser's copy, which the boot script already applied before hydration (null while prerendering).
  const raw = useSyncExternalStore(subscribe, readCache, () => null);
  const cached = useMemo(() => parse(raw), [raw]);
  const uid = session.status === 'ready' ? session.me.uid : null;
  // Changes made in this session, for this account only.
  const [local, setLocal] = useState<{ uid: string | null; prefs: Preferences } | null>(null);
  // The account's saved preferences win over this browser's cache once the user is known.
  const account = session.status === 'ready' ? session.me.preferences : null;
  const preferences = (local?.uid === uid ? local?.prefs : null) ?? account ?? cached ?? DEFAULT_PREFERENCES;
  const ready = raw !== null || account !== null || local !== null;

  useEffect(() => {
    if (!ready) return;
    applyPreferences(preferences);
    try {
      localStorage.setItem(KEY, JSON.stringify(preferences));
    } catch {
      // private mode: the account copy still applies after sign-in
    }
  }, [ready, preferences]);

  const update = useCallback(
    (patch: Partial<Preferences>) => {
      const next = { ...preferences, ...patch };
      setLocal({ uid, prefs: next });
      if (uid) void api('/v1/me/preferences', { method: 'PUT', body: next }).catch(() => undefined);
    },
    [preferences, uid],
  );

  const value = useMemo(() => ({ preferences, update }), [preferences, update]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePreferences(): PreferencesApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('usePreferences outside PreferencesProvider');
  return v;
}
