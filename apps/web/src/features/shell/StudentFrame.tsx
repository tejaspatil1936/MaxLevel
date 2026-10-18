'use client';

import type { MeResponse } from '@mitaoe/shared';
import { useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { RoleGuard } from './RoleGuard';
import { StudentShell } from './StudentShell';

/** STU-01: a student without consent or a complete profile finishes it first. */
function ProfileGate({ me, children }: { me: MeResponse; children: ReactNode }) {
  const router = useRouter();
  useEffect(() => {
    if (!me.profileComplete) router.replace('/profile/');
  }, [me.profileComplete, router]);
  return me.profileComplete ? <>{children}</> : null;
}

/** Student pages: students only (others go to their home), in the student shell, after the profile is complete. */
export function StudentFrame({ children }: { children: ReactNode }) {
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
