import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentsScreen } from '@/features/admin/students/StudentsScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.students') };

export default function StudentsPage() {
  return (
    <Suspense>
      <StudentsScreen />
    </Suspense>
  );
}
