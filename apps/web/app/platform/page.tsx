import type { Metadata } from 'next';
import { OrganizationsList } from '@/features/platform/OrganizationsList';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('platform.title') };

export default function PlatformHome() {
  return <OrganizationsList />;
}
