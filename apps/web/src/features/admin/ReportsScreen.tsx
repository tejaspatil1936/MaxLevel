'use client';

import { PageHeader } from '@mitaoe/ui';
import { t } from '@/i18n';
import { useWorkspace } from '@/lib/workspace';

/** Analytics reports arrive in phase 6; until then, and whenever the plan leaves them out, the page says so (FF-03). */
export function ReportsScreen() {
  const { features } = useWorkspace();
  const included = !!features?.analytics_reports;
  return <PageHeader title={t('nav.reports')} subtitle={t(included ? 'reports.soon' : 'plan.notIncluded')} />;
}
