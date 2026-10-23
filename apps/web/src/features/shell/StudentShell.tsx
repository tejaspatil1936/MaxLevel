'use client';

import type { MeResponse } from '@mitaoe/shared';
import { Button, cx, Menu } from '@mitaoe/ui';
import { ChevronDown, CircleUser } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { t } from '@/i18n';
import { useSession } from '@/lib/session';
import { AccessibilityButton } from './AccessibilityPanel';
import { MaxLevelLogo } from './MaxLevelLogo';
import { STUDENT_NAV } from './nav';

/** Student shell (13.7): one top bar and centred content up to 1,120 px. */
export function StudentShell({ me, children }: { me: MeResponse; children: ReactNode }) {
  const { signOut, switchOrg } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const path = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return (
    <div className="min-h-screen">
      <header className="border-b border-rule bg-surface">
        <div className="mx-auto flex min-h-16 max-w-student flex-wrap items-center justify-between gap-4 px-4 py-2">
          <div className="flex items-center gap-3">
            <MaxLevelLogo size={28} />
            <p className="font-display text-heading-1 font-bold">{me.org?.name ?? t('app.name')}</p>
          </div>
          <nav aria-label={t('nav.main')}>
            <ul className="flex flex-wrap items-center gap-1">
              {STUDENT_NAV.map((link) => {
                const current = link.current(path);
                return (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={current ? 'page' : undefined}
                      className={cx(
                        'flex min-h-11 items-center rounded-control px-3 font-bold hover:bg-ballpoint-wash',
                        current && 'bg-ballpoint-wash text-ballpoint',
                      )}
                    >
                      {t(link.label)}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="flex items-center gap-2">
            <span className="text-body-small text-graphite max-[700px]:hidden">{me.email}</span>
            <AccessibilityButton />
            <Menu
              label={t('account.menu')}
              trigger={
                <Button variant="secondary" className="min-w-11 gap-1 px-2">
                  <CircleUser aria-hidden size={20} />
                  <ChevronDown aria-hidden size={16} />
                </Button>
              }
              items={[
                { label: t('account.profile'), onSelect: () => router.push('/profile/') },
                ...(me.canSwitchOrg
                  ? [
                      {
                        label: t('switcher.label'),
                        onSelect: () => {
                          router.push('/');
                          void switchOrg();
                        },
                      },
                    ]
                  : []),
                { label: t('app.signOut'), onSelect: () => void signOut() },
              ]}
            />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-student px-4 py-8">
        {children}
      </main>
    </div>
  );
}
