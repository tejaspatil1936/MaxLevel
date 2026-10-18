'use client';

import { Button, InlineMessage } from '@mitaoe/ui';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { t } from '@/i18n';
import { homeFor } from '@/lib/homes';
import { useSession } from '@/lib/session';

export function SignInScreen() {
  const { session, signInWithGoogle, chooseOrg } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (session.status === 'ready') router.replace(homeFor(session.me.role));
  }, [session, router]);

  const busy = session.status === 'loading' || session.status === 'signingIn';
  const message =
    session.status === 'notOnList'
      ? t(session.code === 'NOT_ON_LIST' ? 'signIn.notOnList' : 'signIn.unavailable')
      : session.status === 'failed'
        ? t('signIn.failed')
        : null;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-screen max-w-student flex-col justify-center px-4 py-12"
    >
      <h1 className="font-display text-display-2 font-bold">{t('signIn.title')}</h1>
      <p className="mt-4 max-w-measure text-graphite">{t('signIn.lead')}</p>
      {session.status === 'chooseOrg' ? (
        <section aria-labelledby="choose-org" className="mt-8 max-w-measure">
          <h2 id="choose-org" className="text-heading-2 font-bold">
            {t('signIn.chooseOrg')}
          </h2>
          <p className="mt-2 text-graphite">{t('signIn.chooseOrgLead')}</p>
          <ul className="mt-4 flex flex-col gap-3">
            {session.orgs.map((o) => (
              <li key={o.orgId}>
                <Button
                  variant="secondary"
                  size="lg"
                  className="w-full justify-start"
                  onClick={() => void chooseOrg(o.orgId)}
                >
                  {o.name}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
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
      )}
      <div className="mt-6 max-w-measure">
        <InlineMessage>{message}</InlineMessage>
      </div>
    </main>
  );
}
