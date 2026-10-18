import type { Metadata } from 'next';
import { SimpleHome } from '@/features/homes/SimpleHome';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('platform.title') };

export default function PlatformHome() {
  return <SimpleHome title="platform.title" lead="platform.lead" />;
}
