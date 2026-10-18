'use client';

import type { MeResponse } from '@mitaoe/shared';
import { Button, cx } from '@mitaoe/ui';
import { Lock } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '@/i18n';
import { setWorkspaceOrg } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useWorkspaceQuery, workspaceOrgId, WorkspaceContext } from '@/lib/workspace';
import { AccessibilityButton } from './AccessibilityPanel';
import { CommandPalette } from './CommandPalette';
import { ADMIN_NAV, PLATFORM_NAV, type NavLink } from './nav';
import { OrgSwitcher } from './OrgSwitcher';

function SideLink({ link, locked }: { link: NavLink; locked: boolean }) {
  const path = usePathname();
  const current =
    link.href === '/admin/' || link.href === '/platform/' ? path === link.href : path.startsWith(link.href);
  const Icon = link.icon;
  const hintId = `nav-hint-${link.href.replace(/\W/g, '')}`;
  return (
    <li>
      <Link
        href={link.href}
        aria-current={current ? 'page' : undefined}
        aria-describedby={locked ? hintId : undefined}
        className={cx(
          'flex min-h-11 items-center gap-3 rounded-control px-3 font-bold hover:bg-ballpoint-wash max-[1199px]:justify-center',
          current && 'bg-ballpoint-wash text-ballpoint',
        )}
      >
        <Icon aria-hidden size={20} className="shrink-0" />
        <span className="max-[1199px]:sr-only">{t(link.label)}</span>
        {locked ? <Lock aria-hidden size={16} className="ml-auto text-graphite max-[1199px]:hidden" /> : null}
      </Link>
      {locked ? (
        <span id={hintId} className="sr-only">
          {t('plan.notIncluded')}
        </span>
      ) : null}
    </li>
  );
}

/**
 * Admin workspace and platform console shell (13.7): sidebar navigation (icons only below 1,200 px), a top bar naming
 * the workspace, and the page. Super admins get the organization switcher and the `Working in` notice (ORG-12).
 */
export function AdminShell({
  me,
  area,
  children,
}: {
  me: MeResponse;
  area: 'admin' | 'platform';
  children: ReactNode;
}) {
  const { signOut } = useSession();
  const router = useRouter();
  const superAdmin = me.role === 'superAdmin';
  const [orgId, setOrgId] = useState(() => (area === 'admin' ? workspaceOrgId(me) : null));
  if (area === 'platform') setWorkspaceOrg(null);
  const workspace = useWorkspaceQuery(me, orgId);
  const inOrg = area === 'admin' && !!orgId;

  // A super admin who has not chosen an organization works on the platform console.
  useEffect(() => {
    if (area === 'admin' && !orgId) router.replace('/platform/');
  }, [area, orgId, router]);
  if (area === 'admin' && !orgId) return null;

  const links = area === 'admin' ? ADMIN_NAV : PLATFORM_NAV;
  const orgName = workspace.org?.name ?? (me.role === 'admin' ? me.org?.name : undefined) ?? '';
  const features = workspace.features;

  return (
    <WorkspaceContext.Provider value={{ ...workspace, orgId }}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 flex h-screen w-20 shrink-0 flex-col gap-4 overflow-y-auto border-r border-rule bg-surface p-2 min-[1200px]:w-60 min-[1200px]:p-4">
          <p className="flex min-h-11 items-center font-display text-heading-2 font-bold max-[1199px]:justify-center">
            <span className="max-[1199px]:hidden">{t('app.name')}</span>
            <span aria-hidden className="min-[1200px]:hidden">
              {t('app.mark')}
            </span>
          </p>
          {superAdmin ? <OrgSwitcher current={inOrg ? orgName || null : null} onChange={setOrgId} /> : null}
          <nav aria-label={t('nav.main')}>
            <ul className="flex flex-col gap-1">
              {links.map((l) => (
                <SideLink key={l.href} link={l} locked={!!l.feature && !!features && !features[l.feature]} />
              ))}
            </ul>
          </nav>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-rule bg-surface px-6 py-2">
            <p className="font-bold text-ink">
              {area === 'platform'
                ? t('platform.console')
                : superAdmin
                  ? t('admin.workingIn', { org: orgName })
                  : orgName}
            </p>
            <div className="flex items-center gap-2">
              <AccessibilityButton />
              <span className="text-body-small text-graphite max-[1199px]:hidden">{me.email}</span>
              <Button variant="secondary" onClick={() => void signOut()}>
                {t('app.signOut')}
              </Button>
            </div>
          </header>
          <main id="main" tabIndex={-1} className="mx-auto w-full max-w-admin flex-1 px-6 py-8">
            {workspace.readOnly ? (
              <p className="mb-6 rounded-control border border-rule bg-highlighter/30 px-4 py-3 font-bold">
                {t('admin.archivedNotice')}
              </p>
            ) : null}
            {children}
          </main>
        </div>
      </div>
      {inOrg ? <CommandPalette orgId={orgId} links={ADMIN_NAV} /> : null}
    </WorkspaceContext.Provider>
  );
}
