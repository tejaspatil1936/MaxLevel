import type { Metadata } from 'next';
import { SimpleHome } from '@/features/homes/SimpleHome';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('student.title') };

export default function StudentHome() {
  return <SimpleHome title="student.title" lead="student.lead" />;
}
