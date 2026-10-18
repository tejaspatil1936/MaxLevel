import type { Metadata } from 'next';
import { Suspense } from 'react';
import { TestEditor } from '@/features/authoring/tests/TestEditor';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('tests.editor') };

// The test ID travels in ?id= (WEB-02).
export default function TestEditorPage() {
  return (
    <Suspense>
      <TestEditor />
    </Suspense>
  );
}
