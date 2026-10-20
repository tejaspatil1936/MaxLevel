import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ImportReview } from '@/features/authoring/imports/ImportReview';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('imports.reviewPage') };

// The import job ID travels in ?id= (WEB-02).
export default function ImportReviewPage() {
  return (
    <Suspense>
      <ImportReview />
    </Suspense>
  );
}
