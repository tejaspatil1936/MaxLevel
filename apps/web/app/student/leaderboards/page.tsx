import type { Metadata } from 'next';
import { Suspense } from 'react';
import { StudentLeaderboardsScreen } from '@/features/leaderboards/StudentLeaderboardsScreen';
import { t } from '@/i18n';

export const metadata: Metadata = { title: t('leaderboards.title') };

// The board travels in ?board= (WEB-02).
export default function StudentLeaderboardsPage() {
  return (
    <Suspense>
      <StudentLeaderboardsScreen />
    </Suspense>
  );
}
