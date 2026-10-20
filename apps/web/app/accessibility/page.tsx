import type { Metadata } from 'next';
import { AccessibilityStatement } from '@/features/statement/AccessibilityStatement';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('statement.title') };

export default function AccessibilityStatementPage() {
  return <AccessibilityStatement />;
}
