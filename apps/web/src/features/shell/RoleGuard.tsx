'use client';

import type { MeResponse, Role } from '@mitaoe/shared';
import { Button, InlineMessage, Skeleton } from '@mitaoe/ui';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { t } from '@/i18n';
import { homeFor } from '@/lib/homes';
import { useSession } from '@/lib/session';

/**
 * Client route guard (WEB-03): a convenience only, since the API enforces every permission. Signed-out and unlisted
 * visitors go to sign-in; other roles go to their own home.
 */
export function RoleGuard({ roles, children }: { roles: Role[]; children: (me: MeResponse) => ReactNode }) {
  const { session, retry } = useSession();
  const router = useRouter();
  const allowed = session.status === 'ready' && roles.includes(session.me.role);

  useEffect(() => {
    if (['loading', 'signingIn', 'failed'].includes(session.status) || allowed) return;
    router.replace(session.status === 'ready' ? homeFor(session.me.role) : '/');
  }, [session, allowed, router]);

  if (session.status === 'failed') {
    // Still signed in, but the API could not be reached: offer a retry instead of sending them to sign-in.
    return (
      <main id="main" tabIndex={-1} className="mx-auto flex max-w-student flex-col items-start gap-4 px-4 py-12">
        <InlineMessage>{t('session.unreachable')}</InlineMessage>
        <Button onClick={() => void retry()}>{t('session.retry')}</Button>
      </main>
    );
  }
  if (!allowed) {
    return (
      <div aria-busy="true" aria-label={t('app.loading')} className="mx-auto max-w-admin p-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }
  return <>{children(session.me)}</>;
}
