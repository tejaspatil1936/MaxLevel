import type { Metadata } from 'next';
import { StudentHistoryScreen } from '@/features/results/StudentHistoryScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('history.title') };

export default function StudentHistoryPage() {
  return <StudentHistoryScreen />;
}
