import Link from 'next/link';
import type { ReactNode } from 'react';
import { t, type MessageKey } from '@/i18n';
import { config } from '@/lib/config';

/** A statement section: a region named by its level-2 heading. */
function Section({ id, title, children }: { id: string; title: MessageKey; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="mt-10 flex flex-col gap-3">
      <h2 id={id} className="text-heading-2 font-bold">
        {t(title)}
      </h2>
      {children}
    </section>
  );
}

/**
 * The public accessibility statement (A11Y-22, A11Y-18). Static: no sign-in, no API call, no role guard, so every
 * visitor sees the same page even when the API is down.
 */
export function AccessibilityStatement() {
  const email = config.accessibilityEmail;
  return (
    <main id="main" tabIndex={-1} className="mx-auto max-w-student px-4 py-12">
      <h1 className="font-display text-display-2 font-bold">{t('statement.title')}</h1>
      <p className="mt-4 max-w-measure text-graphite">{t('statement.lead')}</p>

      <Section id="statement-standard" title="statement.standard">
        <p className="max-w-measure">{t('statement.standardText')}</p>
        <p className="max-w-measure">{t('statement.standardSettings')}</p>
      </Section>

      <Section id="statement-gaps" title="statement.gaps">
        <p className="max-w-measure">{t('statement.gapsLead')}</p>
        <ul className="flex max-w-measure list-disc flex-col gap-2 pl-6">
          <li>{t('statement.gapAssistive')}</li>
          <li>{t('statement.gapCamera')}</li>
          <li>{t('statement.gapShortcuts')}</li>
        </ul>
        <p className="max-w-measure">{t('statement.gapsHelp')}</p>
      </Section>

      <Section id="statement-timed" title="statement.timed">
        <p className="max-w-measure">{t('statement.timedText')}</p>
        <p className="max-w-measure">{t('statement.timedLead')}</p>
        <ul className="flex max-w-measure list-disc flex-col gap-2 pl-6">
          <li>{t('statement.timedExtra')}</li>
          <li>{t('statement.timedAccommodation')}</li>
        </ul>
      </Section>

      <Section id="statement-contact" title="statement.contact">
        <p className="max-w-measure">{t('statement.contactExam')}</p>
        <p className="max-w-measure">{t('statement.contactEmail')}</p>
        <a
          href={`mailto:${email}`}
          className="inline-flex min-h-11 items-center self-start font-bold text-ballpoint underline [overflow-wrap:anywhere]"
        >
          {email}
        </a>
      </Section>

      <Link href="/" className="mt-10 inline-flex min-h-11 items-center font-bold text-ballpoint underline">
        {t('statement.home')}
      </Link>
    </main>
  );
}
