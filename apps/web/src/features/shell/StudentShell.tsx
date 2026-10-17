'use client';

import type { MeResponse } from '@mitaoe/shared';
import { Button } from '@mitaoe/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { useSession } from '@/lib/session';

/** Student shell (13.7): one top bar and centred content up to 1,120 px. */
export function StudentShell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const { signOut } = useSession();
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex min-h-16 max-w-student flex-wrap items-center justify-between gap-4 px-4">
          <p className="font-display text-heading-1 font-bold">{me.org?.name ?? t('app.name')}</p>
          <nav aria-label={t('nav.main')}>
            <Link
              href="/student/"
              className="flex min-h-11 items-center rounded-control px-3 font-bold hover:bg-ballpoint-wash"
            >
              {t('nav.tests')}
            </Link>
          </nav>
          <Button variant="secondary" onClick={() => void signOut()}>
            {t('app.signOut')}
          </Button>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-student px-4 py-8">
        {children}
      </main>
    </div>
  );
}
