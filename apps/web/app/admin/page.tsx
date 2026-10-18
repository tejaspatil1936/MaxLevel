import type { Metadata } from 'next';
import { AdminOverview } from '@/features/homes/AdminOverview';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('admin.title') };

export default function AdminHome() {
  return <AdminOverview />;
}
