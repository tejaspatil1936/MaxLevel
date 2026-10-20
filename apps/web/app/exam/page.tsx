import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExamRoute } from '@/features/exam/ExamRoute';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('attempt.title') };

// The exam screen, full screen outside any shell. The attempt travels in ?attempt= and an admin's preview in
// ?preview= (WEB-02).
export default function ExamPage() {
  return (
    <Suspense>
      <ExamRoute />
    </Suspense>
  );
}
