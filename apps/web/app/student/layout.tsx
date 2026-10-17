'use client';

import type { ReactNode } from 'react';
import { RoleGuard } from '@/features/shell/RoleGuard';
import { StudentShell } from '@/features/shell/StudentShell';

export default function StudentLayout({ children }: { children: ReactNode }) {
  return <RoleGuard roles={['student']}>{(me) => <StudentShell me={me}>{children}</StudentShell>}</RoleGuard>;
}
