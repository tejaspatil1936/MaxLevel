import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DepartmentsScreen } from '@/features/admin/DepartmentsScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.departments') };

export default function DepartmentsPage() {
  return (
    <Suspense>
      <DepartmentsScreen />
    </Suspense>
  );
}
