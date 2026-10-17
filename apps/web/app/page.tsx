import { t } from '@/i18n';

export default function SignInPage() {
  return (
    <main id="main" className="mx-auto max-w-student px-6 py-12">
      <h1 className="font-display text-display-2 font-bold">{t('signIn.title')}</h1>
      <p className="mt-4 max-w-measure text-graphite">{t('signIn.lead')}</p>
    </main>
  );
}
