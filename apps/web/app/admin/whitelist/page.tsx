import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WhitelistScreen } from '@/features/admin/whitelist/WhitelistScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.whitelist') };

export default function WhitelistPage() {
  return (
    <Suspense>
      <WhitelistScreen />
    </Suspense>
  );
}
