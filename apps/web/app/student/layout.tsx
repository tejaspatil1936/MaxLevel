'use client';

import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { RoleGuard } from '@/features/shell/RoleGuard';
import { StudentShell } from '@/features/shell/StudentShell';
import type { MeResponse } from '@mitaoe/shared';

/** STU-01: a student without consent or a complete profile finishes it first. */
function ProfileGate({ me, children }: { me: MeResponse; children: ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (!me.profileComplete) router.replace('/profile/');
  }, [me.profileComplete, router]);
  return me.profileComplete ? <>{children}</> : null;
}

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard roles={['student']}>
      {(me) => (
        <StudentShell me={me}>
          <ProfileGate me={me}>{children}</ProfileGate>
        </StudentShell>
      )}
    </RoleGuard>
  );
}
