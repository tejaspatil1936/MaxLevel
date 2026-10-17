'use client';

import type { MeResponse } from '@mitaoe/shared';
import { Button } from '@mitaoe/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { useSession } from '@/lib/session';

/** Admin and super-admin shell (13.7): sidebar navigation, a top bar naming the workspace, and the page. */
export function AdminShell({ me, orgName, children }: { me: MeResponse; orgName: string | null; children: ReactNode }) {
  const { signOut } = useSession();
  const home = me.role === 'superAdmin' && !orgName ? '/platform/' : '/admin/';
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <nav
        aria-label={t('nav.main')}
        className="border-b border-rule bg-surface p-4 md:min-h-screen md:border-b-0 md:border-r"
      >
        <p className="font-display text-heading-1 font-bold">{orgName ?? t('app.name')}</p>
        <ul className="mt-6 flex flex-col gap-1">
          <li>
            <Link
              href={home}
              className="flex min-h-11 items-center rounded-control px-3 font-bold hover:bg-ballpoint-wash"
            >
              {orgName ? t('nav.overview') : t('nav.organizations')}
            </Link>
          </li>
        </ul>
      </nav>
      <div className="min-w-0">
        <header className="flex min-h-16 items-center justify-between gap-4 border-b border-rule bg-surface px-6">
          <p className="text-graphite">
            {orgName ? (
              <>
                <span>{t('admin.workspace')}</span> <span className="font-bold text-ink">{orgName}</span>
              </>
            ) : (
              <span className="font-bold text-ink">{t('app.name')}</span>
            )}
          </p>
          <div className="flex items-center gap-3">
            <span className="text-body-small text-graphite">{me.email}</span>
            <Button variant="secondary" onClick={() => void signOut()}>
              {t('app.signOut')}
            </Button>
          </div>
        </header>
        <main id="main" tabIndex={-1} className="mx-auto max-w-admin px-6 py-8">
          {children}
        </main>
      </div>
    </div>
  );
}
