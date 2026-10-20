import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RulesScreen } from '@/features/exam-entry/RulesScreen';
import { StudentFrame } from '@/features/shell/StudentFrame';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('rules.title') };

// The test ID travels in ?test= (WEB-02).
export default function RulesPage() {
  return (
    <StudentFrame>
      <Suspense>
        <RulesScreen />
      </Suspense>
    </StudentFrame>
  );
}
