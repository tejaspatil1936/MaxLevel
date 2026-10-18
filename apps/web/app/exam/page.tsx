import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ExamPreviewRoute } from '@/features/exam/ExamPreview';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('preview.title') };

// The exam screen, full screen outside the admin shell. The test travels in ?preview= (WEB-02); phase 3 adds the
// student's attempt mode to this route.
export default function ExamPage() {
  return (
    <Suspense>
      <ExamPreviewRoute />
    </Suspense>
  );
}
