import type { Metadata } from 'next';
import { ReportsScreen } from '@/features/admin/reports/ReportsScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.reports') };

export default function ReportsPage() {
  return <ReportsScreen />;
}
