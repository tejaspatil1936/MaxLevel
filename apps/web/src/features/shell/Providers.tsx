'use client';

import { Toaster } from '@mitaoe/ui';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { PreferencesProvider } from '@/lib/preferences';
import { SessionProvider } from '@/lib/session';
import { ReadingRuler } from './AccessibilityPanel';
import { ShortcutsProvider } from './Shortcuts';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } }));
  return (
    <QueryClientProvider client={client}>
      <SessionProvider>
        <PreferencesProvider>
          <ShortcutsProvider>{children}</ShortcutsProvider>
          <ReadingRuler />
        </PreferencesProvider>
      </SessionProvider>
      <Toaster />
    </QueryClientProvider>
  );
}
