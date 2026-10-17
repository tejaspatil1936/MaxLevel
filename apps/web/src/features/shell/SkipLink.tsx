import { t } from '@/i18n';

/** First focusable element on every page (A11Y-03). */
export function SkipLink() {
  return (
    <a
      href="#main"
      className="sr-only rounded-control bg-surface px-4 py-2 font-bold text-ballpoint focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50"
    >
      {t('app.skipToContent')}
    </a>
  );
}
