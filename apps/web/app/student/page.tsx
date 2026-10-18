import type { Metadata } from 'next';
import { StudentDashboard } from '@/features/student/StudentDashboard';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('student.title') };

export default function StudentHome() {
  return <StudentDashboard />;
}
