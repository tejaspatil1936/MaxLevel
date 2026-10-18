import type { ReactNode } from 'react';
import { StudentFrame } from '@/features/shell/StudentFrame';

export default function StudentLayout({ children }: { children: ReactNode }) {
  return <StudentFrame>{children}</StudentFrame>;
}
