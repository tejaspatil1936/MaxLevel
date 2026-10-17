'use client';

import { PageHeader } from '@mitaoe/ui';
import { t } from '@/i18n';

export default function PlatformHome() {
  return <PageHeader title={t('platform.title')} subtitle={t('platform.lead')} />;
}
