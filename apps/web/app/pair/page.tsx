import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PhoneScreen } from '@/features/phone/PhoneScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('phone.title') };

// The pairing token travels in ?token= (WEB-02); nobody is signed in on the phone until it is redeemed.
export default function PairPage() {
  return (
    <Suspense>
      <PhoneScreen />
    </Suspense>
  );
}
