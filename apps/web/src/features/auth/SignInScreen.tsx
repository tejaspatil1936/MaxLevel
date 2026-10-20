'use client';

import { Button, InlineMessage } from '@mitaoe/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { t, type MessageKey } from '@/i18n';
import { homeFor } from '@/lib/homes';
import { useSession } from '@/lib/session';

const REFUSALS: Record<string, MessageKey> = {
  NOT_ON_LIST: 'signIn.notOnList',
  ORG_SUSPENDED: 'signIn.suspended',
  ORG_ARCHIVED: 'signIn.archived',
};

export function SignInScreen() {
  const { session, signInWithGoogle, chooseOrg, signOut } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === 'ready') router.replace(homeFor(session.me.role));
  }, [session, router]);

  const busy = session.status === 'loading' || session.status === 'signingIn';
  const message =
    session.status === 'notOnList'
      ? t(REFUSALS[session.code] ?? 'signIn.unavailable')
      : session.status === 'failed'
        ? t('signIn.failed')
        : null;

  if (session.status === 'chooseOrg') {
    return (
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex min-h-screen max-w-student flex-col justify-center px-4 py-12"
      >
        <h1 className="font-display text-display-2 font-bold">{t('signIn.chooseOrg')}</h1>
        <p className="mt-4 max-w-measure text-graphite">{t('signIn.chooseOrgLead')}</p>
        <div role="group" aria-label={t('signIn.yourOrgs')} className="mt-8 flex max-w-measure flex-col gap-3">
          {session.orgs.map((o) => (
            <Button
              key={o.orgId}
              variant="secondary"
              size="lg"
              className="w-full justify-start"
              onClick={() => void chooseOrg(o.orgId)}
            >
              {o.name}
            </Button>
          ))}
        </div>
        <div className="mt-8">
          <Button variant="ghost" onClick={() => void signOut()}>
            {t('app.signOut')}
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-student flex-col justify-center px-4 py-12"
    >
      <h1 className="font-display text-display-2 font-bold">{t('signIn.title')}</h1>
      <p className="mt-4 max-w-measure text-graphite">{t('signIn.lead')}</p>
      <div className="mt-8">
        <Button
          size="lg"
          onClick={() => void signInWithGoogle()}
          disabled={busy}
          aria-describedby={busy ? 'sign-in-progress' : undefined}
        >
          {t('signIn.google')}
        </Button>
        <p id="sign-in-progress" role="status" className="mt-3 min-h-6 text-graphite">
          {session.status === 'signingIn' ? t('signIn.signingIn') : null}
        </p>
      </div>
      <div className="mt-6 max-w-measure">
        <InlineMessage>{message}</InlineMessage>
      </div>
      <Link
        href="/accessibility/"
        className="mt-6 inline-flex min-h-11 items-center self-start font-bold text-ballpoint underline"
      >
        {t('statement.link')}
      </Link>
    </main>
  );
}
