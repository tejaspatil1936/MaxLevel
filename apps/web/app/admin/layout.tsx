'use client';

import type { ReactNode } from 'react';
import { AdminShell } from '@/features/shell/AdminShell';
import { RoleGuard } from '@/features/shell/RoleGuard';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGuard roles={['admin']}>
      {(me) => (
        <AdminShell me={me} orgName={me.org?.name ?? null}>
          {children}
        </AdminShell>
      )}
    </RoleGuard>
  );
}
