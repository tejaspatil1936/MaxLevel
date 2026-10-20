import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentResultScreen } from '@/features/results/StudentResultScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('result.title') };

// The attempt travels in ?attempt= (WEB-02).
export default function StudentResultPage() {
  return (
    <Suspense>
      <StudentResultScreen />
    </Suspense>
  );
}
