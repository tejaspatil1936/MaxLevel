import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SubmittedScreen } from '@/features/exam/SubmittedScreen';
import { StudentFrame } from '@/features/shell/StudentFrame';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('attempt.title') };

// After the exam: the attempt travels in ?attempt= (WEB-02).
export default function SubmittedPage() {
  return (
    <StudentFrame>
      <Suspense>
        <SubmittedScreen />
      </Suspense>
    </StudentFrame>
  );
}
