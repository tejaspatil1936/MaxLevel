import type { Metadata } from 'next';
import { Suspense } from 'react';
import { OrgDetail } from '@/features/platform/OrgDetail';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('platform.orgTitle') };

// The organization ID travels in ?id= (WEB-02).
export default function OrganizationPage() {
  return (
    <Suspense>
      <OrgDetail />
    </Suspense>
  );
}
