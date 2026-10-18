import type { Metadata } from 'next';
import { SettingsScreen } from '@/features/admin/SettingsScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('nav.settings') };

export default function SettingsPage() {
  return <SettingsScreen />;
}
