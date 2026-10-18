'use client';

import type { ReactNode } from 'react';
import { AdminShell } from '@/features/shell/AdminShell';
import { RoleGuard } from '@/features/shell/RoleGuard';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard roles={['superAdmin']}>
      {(me) => (
        <AdminShell me={me} area="platform">
          {children}
        </AdminShell>
      )}
    </RoleGuard>
  );
}
