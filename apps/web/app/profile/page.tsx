import type { Metadata } from 'next';
import { ProfileScreen } from '@/features/profile/ProfileScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('profile.title') };

export default function ProfilePage() {
  return <ProfileScreen />;
}
