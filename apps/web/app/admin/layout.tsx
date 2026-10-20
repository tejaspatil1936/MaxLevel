'use client';

import type { ReactNode } from 'react';
import { AdminShell } from '@/features/shell/AdminShell';
import { RoleGuard } from '@/features/shell/RoleGuard';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard roles={['admin', 'superAdmin']}>
      {(me) => (
        <AdminShell me={me} area="admin">
          {children}
        </AdminShell>
      )}
    </RoleGuard>
  );
}
