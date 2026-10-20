import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentTestScreen } from '@/features/student/StudentTestScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('student.title') };

// The test ID travels in ?id= (WEB-02).
export default function StudentTestPage() {
  return (
    <Suspense>
      <StudentTestScreen />
    </Suspense>
  );
}
