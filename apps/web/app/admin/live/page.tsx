import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LiveScreen } from '@/features/live/LiveScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.live') };

// The test ID travels in ?test= (WEB-02).
export default function LivePage() {
  return (
    <Suspense>
      <LiveScreen />
    </Suspense>
  );
}
