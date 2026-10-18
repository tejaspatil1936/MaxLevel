import type { Metadata } from 'next';
import { OrgAudit } from '@/features/admin/OrgAudit';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.audit') };

export default function AuditPage() {
  return <OrgAudit />;
}
