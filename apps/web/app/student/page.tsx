'use client';

import { PageHeader } from '@mitaoe/ui';
import { t } from '@/i18n';

export default function StudentHome() {
  return <PageHeader title={t('student.title')} subtitle={t('student.lead')} />;
}
