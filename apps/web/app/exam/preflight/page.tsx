import type { Metadata } from 'next';
import { Suspense } from 'react';
import { PreflightScreen } from '@/features/exam-entry/PreflightScreen';
import { StudentFrame } from '@/features/shell/StudentFrame';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('preflight.title') };

// The test ID travels in ?test= (WEB-02).
export default function PreflightPage() {
  return (
    <StudentFrame>
      <Suspense>
        <PreflightScreen />
      </Suspense>
    </StudentFrame>
  );
}
