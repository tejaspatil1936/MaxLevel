import type { Metadata } from 'next';
import { OrgForm } from '@/features/platform/OrgForm';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('org.new') };

export default function NewOrganizationPage() {
  return <OrgForm />;
}
