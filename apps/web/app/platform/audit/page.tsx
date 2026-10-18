import type { Metadata } from 'next';
import { AuditScreen } from '@/features/audit/AuditScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.audit') };

export default function PlatformAuditPage() {
  return <AuditScreen scope="platform" timeZone="Asia/Kolkata" />;
}
